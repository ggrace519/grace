<script lang="ts">
  import { onMount } from "svelte";
  import { generateOpenAIChatCompletion, getModels, getActiveTabPageContent, getSidebarInit, pingSidebarWake, decryptApiKeyFromBackground, encryptApiKeyViaBackground } from "../apis";
  import { splitStream, renderMarkdown } from "../utils";

  type StoredConfig = { url?: string; key?: string; model?: string };

  // Helper for user-friendly error messages
  function getUserFriendlyErrorMessage(error: any): string {
    const errorMessage = error?.message || String(error);
    if (errorMessage.includes("Rate limit") || errorMessage.includes("429")) {
      return "Rate limit exceeded. Please wait a moment and try again.";
    }
    if (errorMessage.includes("Failed to fetch") || errorMessage.includes("NetworkError")) {
      return "Could not connect to Open WebUI. Please check the URL.";
    }
    if (errorMessage.includes("401") || errorMessage.includes("Invalid API key")) {
      return "Invalid API key. Please check your configuration.";
    }
    return errorMessage;
  }

  // ========================================================================
  // ENHANCEMENT: Response Popup and Conversation Management
  // ========================================================================
  // Added variables for displaying AI responses in a dedicated popup modal,
  // managing conversation history, and handling follow-up questions.
  // This allows users to have multi-turn conversations without leaving
  // the current webpage.
  // ========================================================================
  export let sidebarMode = false;

  let show = false;
  let showConfig = true;
  let showResponse = false; // ENHANCEMENT: Controls response popup visibility
  let responseText = ""; // ENHANCEMENT: Current streaming response text
  let thinkingText = ""; // ENHANCEMENT: Thinking tokens from thinking models
  let isThinking = false; // ENHANCEMENT: Whether we're currently in thinking phase
  let thinkingExpanded = false; // ENHANCEMENT: Whether thinking text is expanded
  let responseQuery = ""; // ENHANCEMENT: Original query that triggered response
  let followUpInput = ""; // ENHANCEMENT: Input field for follow-up questions
  let conversationHistory: Array<{role: string, content: string}> = []; // ENHANCEMENT: Multi-turn conversation history
  let isStreaming = false; // ENHANCEMENT: Tracks if response is currently streaming
  let errorMessage = ""; // ENHANCEMENT: Error message for rate limits, etc.
  let showError = false; // ENHANCEMENT: Controls error message visibility

  const closeResponseModal = () => {
    showResponse = false;
    responseText = "";
    thinkingText = "";
    isThinking = false;
    thinkingExpanded = false;
    responseQuery = "";
    followUpInput = "";
    conversationHistory = [];
    isStreaming = false;
  };

  let url = "";
  let key = "";
  let model = "";

  let searchValue = "";
  let models = [];
  /** Page content loaded once during sidebar init (avoids extra message round-trips). */
  let sidebarPageContext = "";
  let responseContainer: HTMLElement | null = null;
  let userScrolledUp = false; // Track if user has manually scrolled up

  const resetConfig = () => {
    console.log("resetConfig");

    if (!isChromeAPIAvailable()) {
      console.debug("Extension: Chrome APIs not available - cannot reset config");
      return;
    }

    try {
      chrome.storage.local.clear().then(() => {
        console.log("Value is cleared");
      });
    } catch (error) {
      if (isContextInvalidatedError(error)) {
        // Expected when extension is reloaded - use debug level
        console.debug("Extension: Chrome storage API not available - extension may have been reloaded");
      } else {
        console.log(error);
      }
      // Security: Removed localStorage fallback - chrome.storage.local is more secure
    }

    url = "";
    key = "";
    model = "";
    models = [];
    showConfig = true;
  };

  const submitHandler = async (e) => {
    e.preventDefault();

    // In sidebar mode, use streaming API
    if (sidebarMode) {
      await handleSidebarSubmit();
      return;
    }

    // Original behavior - open in new tab
    // Security: Validate URL and sanitize search value
    try {
      const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
      if (!['http:', 'https:'].includes(urlObj.protocol)) {
        console.error("Extension: Invalid URL protocol");
        return;
      }

      // Security: Sanitize search value (encodeURIComponent already handles this)
      const sanitizedQuery = encodeURIComponent(searchValue);
      const sanitizedModel = encodeURIComponent(model);

      window.open(
        `${url}/?q=${sanitizedQuery}&models=${sanitizedModel}`,
        "_blank"
      );

      searchValue = "";
      show = false;
    } catch (error) {
      console.error("Extension: Invalid URL format");
    }
  };

  // Handle sidebar chat submission with streaming
  const handleSidebarSubmit = async () => {
    if (!searchValue.trim() || isStreaming) return;
    if (!url || !key || !model) {
      showConfig = true;
      return;
    }

    const userMessage = searchValue.trim();
    searchValue = "";
    isStreaming = true;
    isThinking = false;
    thinkingText = "";
    responseText = "";
    showError = false;
    errorMessage = "";

    // Add user message to history
    conversationHistory = [...conversationHistory, { role: "user", content: userMessage }];

    // When this is the first message in the sidebar, include the current page content as context
    let systemContent = "You are a helpful assistant. Provide clear and concise responses. Use markdown formatting when appropriate.";
    const isFirstMessage = conversationHistory.length === 1;
    if (sidebarMode && isFirstMessage) {
      let pageContext = sidebarPageContext;
      if (!pageContext || pageContext.trim().length === 0) {
        // Ping to wake worker before getting page content
        await pingSidebarWake();
        await new Promise((r) => setTimeout(r, 250));
        try {
          const pageResult = await getActiveTabPageContent();
          if (pageResult?.data && pageResult.data.trim().length > 0) {
            pageContext = pageResult.data;
          } else if (pageResult?.error) {
            console.debug("Extension: Sidebar page context unavailable:", pageResult.error);
          }
        } catch (e) {
          console.debug("Extension: Could not get page context for sidebar:", e);
        }
      }
      if (pageContext && pageContext.trim().length > 0) {
        const maxPageChars = 12000;
        const truncated = pageContext.length > maxPageChars
          ? pageContext.substring(0, maxPageChars) + "\n\n[Content truncated for length.]"
          : pageContext;
        systemContent = `You are a helpful AI assistant in the Open WebUI side panel. The user can have any conversation they want. Below is the extracted text from the web page they currently have open—use it as context when their questions relate to the page (e.g. summarizing, explaining, or tasks based on it). If they ask about something not in the content, answer from your general knowledge and say so when it's not from the page. When they do refer to the page, base your answer on what is actually there. Keep a clear, friendly tone and use markdown when it helps. You only respond in the panel; you cannot interact with the browser.

---
Page content:
---
${truncated}
---
End of page content.
---`;
      }
    }

    // Build messages with system prompt
    const messages = [
      {
        role: "system",
        content: systemContent
      },
      ...conversationHistory.filter(m => m.role !== "system")
    ];

    try {
      const isOpenAI = models.length > 0
        ? (models.find((m) => m.id === model)?.owned_by === "openai")
        : false;
      const endpoint = isOpenAI ? `${url}/openai` : `${url}/ollama/v1`;

      const [res] = await generateOpenAIChatCompletion(
        key,
        { model, messages, stream: true },
        endpoint
      );

      if (!res.ok) {
        errorMessage = `Error: ${res.status} ${res.statusText}`;
        showError = true;
        isStreaming = false;
        return;
      }

      const reader = res.body
        .pipeThrough(new TextDecoderStream())
        .pipeThrough(splitStream("\n"))
        .getReader();

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const lines = value.split("\n");
        for (const line of lines) {
          if (line && line.startsWith("data: ") && line !== "data: [DONE]") {
            try {
              const data = JSON.parse(line.slice(6));
              const content = data.choices?.[0]?.delta?.content ?? "";

              // Check for thinking/reasoning_content (OpenAI o1 models)
              const reasoningContent = data.choices?.[0]?.delta?.reasoning_content;
              if (reasoningContent) {
                if (!isThinking) {
                  isThinking = true;
                }
                thinkingText += reasoningContent;
              }

              if (content) {
                isThinking = false;
                responseText += content;
              }
            } catch (err) {
              // Ignore parse errors for streaming
            }
          }
        }
      }

      // Add assistant response to history
      if (responseText || thinkingText) {
        conversationHistory = [...conversationHistory, {
          role: "assistant",
          content: responseText || thinkingText
        }];
      }
    } catch (error) {
      console.error("Sidebar chat error:", error);
      errorMessage = getUserFriendlyErrorMessage(error);
      showError = true;
    } finally {
      isStreaming = false;
      isThinking = false;
    }
  };

  const initHandler = async (e) => {
    e.preventDefault();

    // ========================================================================
    // ENHANCEMENT: API Key Encryption on Save
    // ========================================================================
    // Encrypts API key before storing in chrome.storage.local. This prevents
    // API keys from being stored in plain text. Includes URL and input validation.
    // ========================================================================
    // Security: Validate URL format before saving
    try {
      const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
      if (!['http:', 'https:'].includes(urlObj.protocol)) {
        console.error("Extension: Invalid URL protocol");
        return;
      }
    } catch (error) {
      console.error("Extension: Invalid URL format");
      return;
    }
    
    // Security: Basic API key validation (non-empty string)
    if (!key || typeof key !== 'string' || key.trim().length === 0) {
      console.error("Extension: Invalid API key");
      return;
    }
    
    // Security: Basic model validation
    if (!model || typeof model !== 'string' || model.trim().length === 0) {
      console.error("Extension: Invalid model");
      return;
    }

    const c = typeof globalThis !== "undefined" ? (globalThis as any).chrome : undefined;
    if (!c?.storage?.local || !c?.runtime?.sendMessage) {
      console.debug("Extension: Chrome APIs not available - cannot save config");
      return;
    }

    try {
      const encryptionResponse = await encryptApiKeyViaBackground(key.trim());
      if (encryptionResponse.error) {
        console.error("Extension: Failed to encrypt API key:", encryptionResponse.error);
        await c.storage.local.set({
          url: url.trim(),
          key: key.trim(),
          model: model.trim()
        });
      } else {
        await c.storage.local.set({
          url: url.trim(),
          key: encryptionResponse.encrypted,
          model: model.trim()
        });
        console.debug("Extension: Config saved (API key encrypted)");
      }
    } catch (error) {
      if (isContextInvalidatedError(error)) {
        console.debug("Extension: Chrome APIs not available - extension may have been reloaded");
      } else {
        console.error("Extension: Error saving config:", error);
      }
    }

    showConfig = false;

    // Fetch models for the sidebar dropdown
    if (sidebarMode && url && key) {
      try {
        models = await getModels(key, url);
      } catch (modelError) {
        console.log("Failed to load models:", modelError);
      }
    }
  };

  // Function to toggle search interface
  const toggleSearch = async () => {
    if (!isChromeAPIAvailable()) {
      console.debug("Extension: Chrome APIs not available - cannot get selection");
      show = !show;
      return;
    }

    try {
      const response = await chrome.runtime.sendMessage({
        action: "getSelection",
      });

      if (response?.data ?? false) {
        searchValue = response.data;
      }
    } catch (error) {
      if (isContextInvalidatedError(error)) {
        // Expected when extension is reloaded - use debug level
        console.debug("Extension: Chrome runtime API not available");
      } else {
        console.log("catch", error);
      }
    }

    show = !show;

    setTimeout(() => {
      const inputElement = document.getElementById(
        "open-webui-search-input"
      );

      if (inputElement) {
        inputElement.focus();
      }
    }, 0);
  };

  // ========================================================================
  // ENHANCEMENT: Summarize Page Feature
  // ========================================================================
  // Summarizes the content of the current page using AI. Uses a specialized
  // system prompt to ignore navigation, ads, and other non-content elements.
  // Displays the summary in the response popup.
  // ========================================================================
  // Function to summarize page content
  const summarizePage = async (content: string): Promise<void> => {
    if (!content || content.trim().length === 0) {
      console.warn("Extension: No content to summarize");
      errorMessage = "No content could be extracted from this page.";
      showError = true;
      showResponse = true;
      setTimeout(() => {
        showError = false;
        errorMessage = "";
      }, 5000);
      return;
    }

    // Get current config
    let currentUrl = url;
    let currentKey = key;
    let currentModel = model;

    if (!isChromeAPIAvailable()) {
      console.debug("Extension: Chrome APIs not available - cannot get config");
      if (!currentUrl || !currentKey || !currentModel) {
        showResponse = true;
        showError = true;
        errorMessage = "Extension was reloaded or is unavailable. Please refresh the page and try again.";
        setTimeout(() => {
          showError = false;
          errorMessage = "";
        }, 8000);
        return;
      }
    } else {
      try {
        const storedConfig = (await chrome.storage.local.get(["url", "key", "model"])) as StoredConfig;
        if (storedConfig.url) currentUrl = storedConfig.url;
        if (storedConfig.model) currentModel = storedConfig.model;
        
        // Decrypt API key if it exists (uses retry for port-closed errors)
        if (storedConfig.key) {
          const decryptionResponse = await decryptApiKeyFromBackground(storedConfig.key);
          if (decryptionResponse?.error) {
            console.debug("Extension: Decrypt unavailable, using stored key as-is:", decryptionResponse.error);
            currentKey = storedConfig.key;
          } else {
            currentKey = decryptionResponse.decrypted ?? storedConfig.key;
          }
        }
      } catch (error) {
        if (isContextInvalidatedError(error)) {
          // Expected when extension is reloaded - use debug level
          console.debug("Extension: Chrome storage API not available - extension may have been reloaded");
        } else {
          console.error("Extension: Error getting config:", error);
        }
      }
    }

    // Check if we have valid config - show modal with error so user sees the response UI
    if (!currentUrl || !currentKey || !currentModel) {
      console.warn("Extension: Missing configuration. Please configure the extension first.");
      showResponse = true;
      showError = true;
      errorMessage = "Please configure the extension first. Use the search bar settings (gear icon) to set Open WebUI URL, API key, and model.";
      setTimeout(() => {
        showError = false;
        errorMessage = "";
      }, 8000);
      return;
    }

    // Initialize conversation with specialized system prompt for page summarization
    responseQuery = "Summarize this page";
    responseText = "";
    thinkingText = "";
    isThinking = true; // Start in thinking mode
    thinkingExpanded = false;
    conversationHistory = [
      {
        role: "system",
        content: "You are a helpful assistant that summarizes web page content. Ignore navigation menus, advertisements, cookie notices, footers, headers, and other non-content elements. Focus on the main article or content of the page. Provide a clear, concise summary. You can use markdown formatting (headers, lists, code blocks, bold, italic, etc.) to make your response more readable and well-structured."
      },
      {
        role: "user",
        content: content.substring(0, 50000) // Limit content length
      }
    ];
    showResponse = true;
    isStreaming = true;
    userScrolledUp = false; // Reset scroll flag for new stream
    showError = false;
    errorMessage = "";

    // Determine endpoint
    const isOpenAI = models.length > 0 
      ? (models.find((m) => m.id === currentModel)?.owned_by === "openai")
      : false;
    
    const endpoint = isOpenAI ? `${currentUrl}/openai` : `${currentUrl}/ollama/v1`;

    try {
      const [res, controller] = await generateOpenAIChatCompletion(
        currentKey,
        {
          model: currentModel,
          messages: conversationHistory,
          stream: true,
          features: {
            web_search: true
          }
        },
        endpoint
      );

      if (res && res.ok) {
        const reader = res.body
          .pipeThrough(new TextDecoderStream())
          .pipeThrough(splitStream("\n"))
          .getReader();

        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            break;
          }

              try {
            let lines = value.split("\n");
            for (const line of lines) {
              if (line !== "") {
                if (line === "data: [DONE]") {
                  // Will handle after loop
                } else {
                  let data = JSON.parse(line.replace(/^data: /, ""));
                  if (!("request_id" in data)) {
                    const content = data.choices[0].delta.content ?? "";
                    processStreamingContent(content);
                    
                    // Smart auto-scroll (only if user is near bottom)
                    setTimeout(() => {
                      smartScrollToBottom(responseContainer);
                    }, 0);
                  }
                }
              }
            }
          } catch (error) {
            console.log(error);
          }
        }
        
        // Add assistant response to conversation history after streaming completes
        try {
          // If we're still in thinking mode when streaming completes, 
          // move thinking text to response (no separator was detected)
          if (isThinking && thinkingText && !responseText) {
            responseText = thinkingText;
            thinkingText = "";
            isThinking = false;
          }
          
          // Combine thinking and response for history (if thinking exists)
          const fullResponse = thinkingText ? `${thinkingText}\n\n${responseText}` : responseText;
          if (fullResponse) {
            const alreadyInHistory = conversationHistory.some(
              m => m.role === "assistant" && m.content === fullResponse
            );
            
            if (!alreadyInHistory) {
              conversationHistory = [...conversationHistory, {
                role: "assistant",
                content: fullResponse,
              }];
            }
          }
          isStreaming = false;
          responseText = "";
          thinkingText = "";
          isThinking = false;
          
          // Focus the follow-up input after response completes
          setTimeout(() => {
            const inputElement = document.getElementById("open-webui-followup-input");
            if (inputElement) {
              inputElement.focus();
            }
          }, 100);
        } catch (historyError) {
          console.error("Extension: Error adding response to history:", historyError);
          isStreaming = false;
        }
      } else {
        console.error("Extension: API request failed:", res);
        showResponse = false;
        isStreaming = false;
        errorMessage = "Failed to get summary. Please check your configuration.";
        showError = true;
        setTimeout(() => {
          showError = false;
          errorMessage = "";
        }, 5000);
      }
    } catch (error) {
      // Extension context invalidated errors happen when extension is reloaded - handle gracefully
      if (isContextInvalidatedError(error)) {
        // Extension was reloaded - just stop streaming, don't show error
        isStreaming = false;
        showResponse = false;
        return;
      }
      
      console.error("Extension: Error summarizing page:", error);
      
      // Check if it's a rate limit error
      const errorMsg = error?.message || String(error);
      if (errorMsg.includes("Rate limit exceeded")) {
        errorMessage = errorMsg;
        showError = true;
        showResponse = true;
        setTimeout(() => {
          showError = false;
          errorMessage = "";
        }, 5000);
      } else {
        errorMessage = `Error: ${errorMsg}`;
        showError = true;
        showResponse = true;
        setTimeout(() => {
          showError = false;
          errorMessage = "";
        }, 5000);
      }
      
      isStreaming = false;
    }
  };

  // ========================================================================
  // ENHANCEMENT: Explain Text Feature
  // ========================================================================
  // Explains selected text using AI. Uses a specialized system prompt to
  // provide clear definitions, examples, related concepts, and background
  // information. Displays the explanation in the response popup.
  // ========================================================================
  // Function to explain selected text
  const explainText = async (selectedText: string): Promise<void> => {
    if (!selectedText || selectedText.trim().length === 0) {
      console.warn("Extension: No text to explain");
      errorMessage = "No text was selected. Please select some text and try again.";
      showError = true;
      showResponse = true;
      setTimeout(() => {
        showError = false;
        errorMessage = "";
      }, 5000);
      return;
    }

    // Get current config
    let currentUrl = url;
    let currentKey = key;
    let currentModel = model;

    if (!isChromeAPIAvailable()) {
      console.debug("Extension: Chrome APIs not available - cannot get config");
      if (!currentUrl || !currentKey || !currentModel) {
        showResponse = true;
        showError = true;
        errorMessage = "Extension was reloaded or is unavailable. Please refresh the page and try again.";
        setTimeout(() => {
          showError = false;
          errorMessage = "";
        }, 8000);
        return;
      }
    } else {
      try {
        const storedConfig = (await chrome.storage.local.get(["url", "key", "model"])) as StoredConfig;
        if (storedConfig.url) currentUrl = storedConfig.url;
        if (storedConfig.model) currentModel = storedConfig.model;
        
        // Decrypt API key if it exists
        if (storedConfig.key) {
              try {
            const decryptionResponse = await chrome.runtime.sendMessage({
              action: "decryptApiKey",
              encryptedApiKey: storedConfig.key
            });
            
            if (decryptionResponse.error) {
              console.error("Extension: Failed to decrypt API key:", decryptionResponse.error);
              currentKey = storedConfig.key; // Use as-is (backward compatibility)
            } else {
              currentKey = decryptionResponse.decrypted;
            }
          } catch (error) {
            const errorMsg = error?.message || String(error);
            if (errorMsg.includes("Extension context invalidated") || 
                errorMsg.includes("Cannot read properties of undefined")) {
              console.warn("Extension: Chrome runtime API not available");
              currentKey = storedConfig.key; // Use as-is (backward compatibility)
            } else {
              console.error("Extension: Error decrypting API key:", error);
              currentKey = storedConfig.key; // Use as-is (backward compatibility)
            }
          }
        }
      } catch (error) {
        const errorMsg = error?.message || String(error);
        if (errorMsg.includes("Extension context invalidated") || 
            errorMsg.includes("Cannot read properties of undefined")) {
          console.warn("Extension: Chrome storage API not available - extension may have been reloaded");
        } else {
          console.error("Extension: Error getting config:", error);
        }
      }
    }

    // Check if we have valid config - show modal with error so user sees the response UI
    if (!currentUrl || !currentKey || !currentModel) {
      console.warn("Extension: Missing configuration. Please configure the extension first.");
      showResponse = true;
      showError = true;
      errorMessage = "Please configure the extension first. Use the search bar settings (gear icon) to set Open WebUI URL, API key, and model.";
      setTimeout(() => {
        showError = false;
        errorMessage = "";
      }, 8000);
      return;
    }

    // Initialize conversation with specialized system prompt for text explanation
    responseQuery = selectedText.substring(0, 100);
    responseText = "";
    thinkingText = "";
    isThinking = true; // Start in thinking mode
    thinkingExpanded = false;
    conversationHistory = [
      {
        role: "system",
        content: `I need help understanding a concept or term mentioned in this text: ${selectedText}\n\nPlease explain this term/concept in simple, clear language. Provide a definition and offer examples to illustrate your point.\n\nIf there are any related ideas or concepts that I should know about, please summarize those as well.\n\nAdditionally, if you can provide any context or background information that might be helpful for understanding the term/concept, please do so. You have access to web search - use it to find current information, recent developments, or additional context that would help explain the concept better.\n\nYou can use markdown formatting (headers, lists, code blocks, bold, italic, etc.) to make your explanation more readable and well-structured.`
      },
      {
        role: "user",
        content: selectedText
      }
    ];
    showResponse = true;
    isStreaming = true;
    userScrolledUp = false; // Reset scroll flag for new stream
    showError = false;
    errorMessage = "";

    // Determine endpoint
    const isOpenAI = models.length > 0 
      ? (models.find((m) => m.id === currentModel)?.owned_by === "openai")
      : false;
    
    const endpoint = isOpenAI ? `${currentUrl}/openai` : `${currentUrl}/ollama/v1`;

    try {
      const [res, controller] = await generateOpenAIChatCompletion(
        currentKey,
        {
          model: currentModel,
          messages: conversationHistory,
          stream: true,
          features: {
            web_search: true
          }
        },
        endpoint
      );

      if (res && res.ok) {
        const reader = res.body
          .pipeThrough(new TextDecoderStream())
          .pipeThrough(splitStream("\n"))
          .getReader();

        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            break;
          }

              try {
            let lines = value.split("\n");
            for (const line of lines) {
              if (line !== "") {
                if (line === "data: [DONE]") {
                  // Will handle after loop
                } else {
                  let data = JSON.parse(line.replace(/^data: /, ""));
                  if (!("request_id" in data)) {
                    const content = data.choices[0].delta.content ?? "";
                    processStreamingContent(content);
                    
                    // Smart auto-scroll (only if user is near bottom)
                    setTimeout(() => {
                      smartScrollToBottom(responseContainer);
                    }, 0);
                  }
                }
              }
            }
          } catch (error) {
            console.log(error);
          }
        }
        
        // Add assistant response to conversation history after streaming completes
        try {
          // If we're still in thinking mode when streaming completes, 
          // move thinking text to response (no separator was detected)
          if (isThinking && thinkingText && !responseText) {
            responseText = thinkingText;
            thinkingText = "";
            isThinking = false;
          }
          
          // Combine thinking and response for history (if thinking exists)
          const fullResponse = thinkingText ? `${thinkingText}\n\n${responseText}` : responseText;
          if (fullResponse) {
            const alreadyInHistory = conversationHistory.some(
              m => m.role === "assistant" && m.content === fullResponse
            );
            
            if (!alreadyInHistory) {
              conversationHistory = [...conversationHistory, {
                role: "assistant",
                content: fullResponse,
              }];
            }
          }
          isStreaming = false;
          responseText = "";
          thinkingText = "";
          isThinking = false;
          
          // Focus the follow-up input after response completes
          setTimeout(() => {
            const inputElement = document.getElementById("open-webui-followup-input");
            if (inputElement) {
              inputElement.focus();
            }
          }, 100);
        } catch (historyError) {
          console.error("Extension: Error adding response to history:", historyError);
          isStreaming = false;
        }
      } else {
        console.error("Extension: API request failed:", res);
        showResponse = false;
        isStreaming = false;
        errorMessage = "Failed to get explanation. Please check your configuration.";
        showError = true;
        setTimeout(() => {
          showError = false;
          errorMessage = "";
        }, 5000);
      }
    } catch (error) {
      // Extension context invalidated errors happen when extension is reloaded - handle gracefully
      if (isContextInvalidatedError(error)) {
        // Extension was reloaded - just stop streaming, don't show error
        isStreaming = false;
        showResponse = false;
        return;
      }
      
      console.error("Extension: Error explaining text:", error);
      const errorMsg = error?.message || String(error);
      // Check if it's a rate limit error
      if (errorMsg.includes("Rate limit exceeded")) {
        errorMessage = errorMsg;
        showError = true;
        showResponse = true;
        setTimeout(() => {
          showError = false;
          errorMessage = "";
        }, 5000);
      } else {
        errorMessage = `Error: ${errorMsg}`;
        showError = true;
        showResponse = true;
        setTimeout(() => {
          showError = false;
          errorMessage = "";
        }, 5000);
      }
      
      isStreaming = false;
    }
  };

  // ========================================================================
  // ENHANCEMENT: Continue in OpenWebUI Feature
  // ========================================================================
  // Transfers the current conversation from the extension to the full OpenWebUI
  // interface. Creates a new chat via API and opens it in a new tab. Includes
  // fallback logic if API call fails.
  // ========================================================================
  // Function to continue conversation in OpenWebUI
  const continueInOpenWebUI = async () => {
    if (!url || conversationHistory.length === 0) {
      console.warn("Extension: No conversation to continue or URL not configured");
      return;
    }

    if (!isChromeAPIAvailable()) {
      console.debug("Extension: Chrome APIs not available - cannot continue in OpenWebUI");
      // Fallback: just open the URL
      window.open(url, "_blank");
      return;
    }

    try {
      // Get current config (decrypt API key if needed)
      let currentUrl = url;
      let currentKey = key;
      
      try {
        const storedConfig = (await chrome.storage.local.get(["url", "key"])) as StoredConfig;
        if (storedConfig.url) currentUrl = storedConfig.url;
        if (storedConfig.key) {
          // Decrypt API key if needed
              try {
            const decryptionResponse = await chrome.runtime.sendMessage({
              action: "decryptApiKey",
              encryptedApiKey: storedConfig.key
            });
            if (!decryptionResponse.error) {
              currentKey = decryptionResponse.decrypted;
            } else {
              currentKey = storedConfig.key; // Use as-is (backward compatibility)
            }
          } catch (error) {
            if (isContextInvalidatedError(error)) {
              // Expected when extension is reloaded - use debug level
              console.debug("Extension: Chrome runtime API not available");
            }
            currentKey = storedConfig.key; // Use as-is (backward compatibility)
          }
        }
      } catch (error) {
        if (isContextInvalidatedError(error)) {
          // Expected when extension is reloaded - use debug level
          console.debug("Extension: Chrome storage API not available");
        } else {
          console.error("Extension: Error getting config:", error);
        }
      }

      // Filter out system messages and format conversation for OpenWebUI
      const messages = conversationHistory.filter(m => m.role !== "system");
      
      if (messages.length === 0) {
        console.warn("Extension: No messages to send");
        return;
      }

      // Try to create a conversation via OpenWebUI API (proxied through background script)
      try {
        const createChatResponse = await chrome.runtime.sendMessage({
          action: "createChat",
          url: currentUrl,
          api_key: currentKey,
          body: {
            title: messages[0]?.content?.substring(0, 50) || "Extension Conversation",
            messages: messages,
          },
        });

        if (createChatResponse.data && createChatResponse.data.id) {
          // Open the conversation in OpenWebUI
          window.open(`${currentUrl}/chat/${createChatResponse.data.id}`, "_blank");
          return;
        } else if (createChatResponse.error) {
          console.log("Extension: Could not create chat via API, trying URL parameters:", createChatResponse.error);
        }
      } catch (apiError) {
        console.log("Extension: Could not create chat via API, trying URL parameters:", apiError);
      }

      // Fallback: Open with first message as query parameter
      // OpenWebUI will create a new conversation with this message
      const firstUserMessage = messages.find(m => m.role === "user");
      if (firstUserMessage) {
        const query = encodeURIComponent(firstUserMessage.content);
        window.open(`${currentUrl}/?q=${query}`, "_blank");
      } else {
        // Last resort: just open OpenWebUI
        window.open(currentUrl, "_blank");
      }
    } catch (error) {
      console.error("Extension: Error continuing in OpenWebUI:", error);
      // Fallback: just open the base URL
      try {
        const storedConfig = await chrome.storage.local.get(["url"]);
        if (storedConfig.url) {
          window.open(storedConfig.url as string, "_blank");
        }
      } catch (fallbackError) {
        console.error("Extension: Could not open OpenWebUI:", fallbackError);
      }
    }
  };

  // ========================================================================
  // ENHANCEMENT: Follow-up Questions Feature
  // ========================================================================
  // Allows users to ask follow-up questions in the response popup, maintaining
  // conversation context. Updates conversation history and streams new responses.
  // Includes client-side rate limiting checks and proper Svelte reactivity handling.
  // ========================================================================
  // Function to send follow-up question
  const sendFollowUp = async () => {
    // Client-side check to prevent UI spam (rate limiting is also handled by background script)
    if (!followUpInput.trim() || isStreaming) return;

    const question = followUpInput.trim();
    followUpInput = "";

    // Make sure previous assistant response is in history before adding new question
    if (responseText) {
      const alreadyInHistory = conversationHistory.some(
        m => m.role === "assistant" && m.content === responseText
      );
      
      if (!alreadyInHistory) {
        conversationHistory = [...conversationHistory, {
          role: "assistant",
          content: responseText,
        }];
      }
    }

    // Add user question to conversation history (reassign for reactivity)
    conversationHistory = [...conversationHistory, {
      role: "user",
      content: question,
    }];

    // Clear current streaming response and start new one
    responseText = "";
    thinkingText = "";
    isThinking = true; // Start in thinking mode
    thinkingExpanded = false;
    isStreaming = true;
    userScrolledUp = false; // Reset scroll flag for new stream
    
    // Focus the input after a short delay
    setTimeout(() => {
      const inputElement = document.getElementById("open-webui-followup-input");
      if (inputElement) {
        inputElement.focus();
      }
    }, 100);

    // Get current config
    let currentUrl = url;
    let currentKey = key;
    let currentModel = model;

        try {
          const storedConfig = (await chrome.storage.local.get(["url", "key", "model"])) as StoredConfig;
          if (storedConfig.url) currentUrl = storedConfig.url;
          if (storedConfig.model) currentModel = storedConfig.model;
          
          // Decrypt API key if it exists
          if (storedConfig.key) {
            try {
              const decryptionResponse = await chrome.runtime.sendMessage({
                action: "decryptApiKey",
                encryptedApiKey: storedConfig.key
              });
              
              if (decryptionResponse.error) {
                console.error("Extension: Failed to decrypt API key:", decryptionResponse.error);
                currentKey = storedConfig.key; // Use as-is (backward compatibility)
              } else {
                currentKey = decryptionResponse.decrypted;
              }
            } catch (error) {
              console.error("Extension: Error decrypting API key:", error);
              currentKey = storedConfig.key; // Use as-is (backward compatibility)
            }
          }
        } catch (error) {
          // Extension context might be invalidated - use existing values
          if (error.message && error.message.includes("Extension context invalidated")) {
            // Silently use existing config values
          } else {
            console.log("Failed to get stored config:", error);
          }
        }

    // Determine endpoint
    const isOpenAI = models.length > 0 
      ? (models.find((m) => m.id === currentModel)?.owned_by === "openai")
      : false;
    
    const endpoint = isOpenAI ? `${currentUrl}/openai` : `${currentUrl}/ollama/v1`;

    try {
      const [res, controller] = await generateOpenAIChatCompletion(
        currentKey,
        {
          model: currentModel,
          messages: conversationHistory,
          stream: true,
          features: {
            web_search: true
          }
        },
        endpoint
      );

      if (res && res.ok) {
        const reader = res.body
          .pipeThrough(new TextDecoderStream())
          .pipeThrough(splitStream("\n"))
          .getReader();

        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            break;
          }

              try {
            let lines = value.split("\n");
            for (const line of lines) {
              if (line !== "") {
                if (line === "data: [DONE]") {
                  // Will handle after loop
                } else {
                  let data = JSON.parse(line.replace(/^data: /, ""));
                  if (!("request_id" in data)) {
                    const content = data.choices[0].delta.content ?? "";
                    processStreamingContent(content);
                    
                    // Smart auto-scroll (only if user is near bottom)
                    setTimeout(() => {
                      smartScrollToBottom(responseContainer);
                    }, 0);
                  }
                }
              }
            }
          } catch (error) {
            console.log(error);
          }
        }
        
        // Add assistant response to conversation history after streaming completes
        try {
          if (responseText) {
            // Check if this response is already in history (avoid duplicates)
            const alreadyInHistory = conversationHistory.some(
              m => m.role === "assistant" && m.content === responseText
            );
            
            if (!alreadyInHistory) {
              // Reassign to trigger Svelte reactivity
              conversationHistory = [...conversationHistory, {
                role: "assistant",
                content: responseText,
              }];
            }
          }
          isStreaming = false;
          // Clear responseText after adding to history so it doesn't interfere with display
          responseText = "";
          
          // Focus the follow-up input after response completes
          setTimeout(() => {
            const inputElement = document.getElementById("open-webui-followup-input");
            if (inputElement) {
              inputElement.focus();
            }
          }, 100);
        } catch (historyError) {
          // Even if adding to history fails, we should still show the response
          console.error("Extension: Error adding response to history:", historyError);
          isStreaming = false;
          // Don't clear responseText if we couldn't add it to history
        }
      } else {
        console.error("Extension: API request failed:", res);
        isStreaming = false;
      }
    } catch (error) {
      console.error("Extension: Error sending follow-up:", error);
      
      // Check if it's a rate limit error
      const errorMsg = error?.message || String(error);
      if (errorMsg.includes("Rate limit exceeded")) {
        errorMessage = errorMsg;
        showError = true;
        // Auto-hide error after 5 seconds
        setTimeout(() => {
          showError = false;
          errorMessage = "";
        }, 5000);
      }
      
      // If we have a response but hit an error, try to save it anyway
      if (responseText && isStreaming) {
        try {
          const alreadyInHistory = conversationHistory.some(
            m => m.role === "assistant" && m.content === responseText
          );
          if (!alreadyInHistory) {
            conversationHistory = [...conversationHistory, {
              role: "assistant",
              content: responseText,
            }];
          }
        } catch (saveError) {
          console.error("Extension: Could not save response:", saveError);
        }
      }
      isStreaming = false;
    }
  };

  // ========================================================================
  // ENHANCEMENT: Smart Auto-Scroll
  // ========================================================================
  // Only auto-scrolls if the user is already near the bottom of the container.
  // This allows users to scroll up and read without being forced back to bottom.
  // ========================================================================
  const smartScrollToBottom = (container: HTMLElement | null): void => {
    if (!container) return;
    
    // Check if user is near the bottom (within 100px threshold)
    const scrollThreshold = 100;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    
    // Only auto-scroll if user is near the bottom
    if (distanceFromBottom <= scrollThreshold) {
      container.scrollTop = container.scrollHeight;
      userScrolledUp = false; // Reset flag if we auto-scrolled
    } else {
      userScrolledUp = true; // User has scrolled up
    }
  };

  // ========================================================================
  // ENHANCEMENT: Thinking Token Detection and Separation
  // ========================================================================
  // Detects when thinking tokens end and actual response begins.
  // Common pattern: thinking text followed by \n\n separator.
  // ========================================================================
  const processStreamingContent = (content: string): void => {
    if (isThinking) {
      // Check for double newline separator (most common pattern)
      const doubleNewlineIndex = content.indexOf('\n\n');
      
      if (doubleNewlineIndex !== -1) {
        // Found transition point - split thinking from response
        thinkingText += content.substring(0, doubleNewlineIndex);
        responseText = content.substring(doubleNewlineIndex + 2); // Skip the \n\n
        isThinking = false;
      } else {
        // Still in thinking phase - accumulate thinking text
        thinkingText += content;
      }
    } else {
      // Already in response phase - accumulate response text
      responseText += content;
    }
  };

  // Helper function to check if Chrome APIs are available.
  // Use globalThis to read chrome so we get the real extension API in side panel / extension pages.
  const isChromeAPIAvailable = (): boolean => {
    try {
      const c = typeof globalThis !== 'undefined' ? (globalThis as any).chrome : undefined;
      return typeof c !== 'undefined' && 
             c !== null && 
             typeof c.storage !== 'undefined' && 
             c.storage !== null &&
             typeof c.storage.local !== 'undefined' &&
             typeof c.runtime !== 'undefined' &&
             c.runtime !== null;
    } catch {
      return false;
    }
  };

  // Helper function to check if an error is an expected "Extension context invalidated" error
  // These errors occur when the extension is reloaded and are not actual errors
  const isContextInvalidatedError = (error: any): boolean => {
    const errorMsg = error?.message || String(error);
    return errorMsg.includes("Extension context invalidated") || 
           errorMsg.includes("Cannot read properties of undefined") ||
           errorMsg.includes("Chrome APIs not available");
  };

  onMount(() => {
    // Only initialize in main frame to avoid duplicate processing when all_frames: true
    if (window !== window.top) {
      return;
    }

    // In sidebar mode, show the main search by default
    if (sidebarMode) {
      show = true;
      showConfig = false;
    }

    // Define handlers first so they can be registered in both branches
    const handleToggleEvent = () => {
      toggleSearch();
    };
    const handleSummarizeEvent = (event: CustomEvent) => {
      if (event.detail && event.detail.content) {
        summarizePage(event.detail.content);
      }
    };
    let isExplaining = false;
    const handleExplainTextEvent = (event: CustomEvent) => {
      if (window === window.top && !isExplaining && event.detail && event.detail.text) {
        isExplaining = true;
        explainText(event.detail.text).finally(() => {
          isExplaining = false;
        });
      }
    };
    let isSummarizing = false;
    const messageListener = (request: { action: string; content?: string; text?: string; error?: string }, _sender: unknown, sendResponse: (r: { success: boolean }) => void) => {
      if (request.action === "toggleSearch") {
        // Only process in main frame
        if (window === window.top) {
          toggleSearch();
        }
        sendResponse({ success: true });
      } else if (request.action === "summarizePage") {
        // Only process in main frame and prevent duplicate processing
        if (window === window.top && !isSummarizing) {
          isSummarizing = true;
          if (request.error) {
            console.error("Extension: Error from background script:", request.error);
            errorMessage = request.error;
            showError = true;
            showResponse = true;
            setTimeout(() => {
              showError = false;
              errorMessage = "";
              isSummarizing = false;
            }, 5000);
          } else if (request.content) {
            summarizePage(request.content).finally(() => {
              isSummarizing = false;
            });
          } else {
            isSummarizing = false;
          }
        }
        sendResponse({ success: true });
      } else if (request.action === "explainText") {
        // Only process in main frame and prevent duplicate processing
        // Use the same isExplaining flag as the custom event handler
        if (window === window.top && !isExplaining) {
          isExplaining = true;
          if (request.error) {
            console.error("Extension: Error from background script:", request.error);
            errorMessage = request.error;
            showError = true;
            showResponse = true;
            setTimeout(() => {
              showError = false;
              errorMessage = "";
              isExplaining = false;
            }, 5000);
          } else if (request.text) {
            explainText(request.text).finally(() => {
              isExplaining = false;
            });
          } else {
            isExplaining = false;
          }
        }
        sendResponse({ success: true });
      }
      return true;
    };

    // Register listeners. In sidebar mode we're in the extension side panel so Chrome APIs exist — always try.
    const tryRegisterChrome = () => {
      try {
        if (typeof (globalThis as any).chrome !== 'undefined' && (globalThis as any).chrome?.runtime?.onMessage) {
          window.openWebUIToggleSearch = toggleSearch;
          window.addEventListener("open-webui-toggle-search", handleToggleEvent);
          window.addEventListener("open-webui-summarize-page", handleSummarizeEvent as EventListener);
          window.addEventListener("open-webui-explain-text", handleExplainTextEvent as EventListener);
          (globalThis as any).chrome.runtime.onMessage.addListener(messageListener);
          return true;
        }
      } catch (_) {
        // ignore
      }
      return false;
    };
    if (sidebarMode || isChromeAPIAvailable()) {
      if (!tryRegisterChrome()) {
        if (!sidebarMode) {
          console.debug("Extension: Chrome APIs not available. Extension may have been reloaded or context invalidated.");
        }
        window.addEventListener("open-webui-summarize-page", handleSummarizeEvent as EventListener);
        window.addEventListener("open-webui-explain-text", handleExplainTextEvent as EventListener);
      }
    } else {
      console.debug("Extension: Chrome APIs not available. Extension may have been reloaded or context invalidated.");
      window.addEventListener("open-webui-summarize-page", handleSummarizeEvent as EventListener);
      window.addEventListener("open-webui-explain-text", handleExplainTextEvent as EventListener);
    }

    const down = async (e) => {
      // Reset the configuration when ⌘Shift+Escape is pressed
      if (show && e.shiftKey && e.key === "Escape") {
        resetConfig();
      } else if (e.key === "Escape") {
        if (showResponse) {
          showResponse = false;
          responseText = "";
          responseQuery = "";
          followUpInput = "";
          conversationHistory = [];
          isStreaming = false;
        } else {
          show = false;
        }
      }

      // ====================================================================
      // ENHANCEMENT: Direct AI Response via Keyboard Shortcut
      // ====================================================================
      // Ctrl+Shift+Enter (or Cmd+Shift+Enter) with selected text triggers
      // an AI response popup instead of navigating to OpenWebUI. Includes
      // API key decryption, conversation history management, and streaming
      // response display. Always fetches fresh config from storage.
      // ====================================================================
      // Handle Ctrl+Shift+Enter (or Cmd+Shift+Enter) - get AI response directly
      if (
        e.key === "Enter" &&
        (e.metaKey || e.ctrlKey) &&
        (e.shiftKey || e.altKey)
      ) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        // Always fetch fresh config from storage to ensure we have it
        let currentUrl = url;
        let currentKey = key;
        let currentModel = model;

        if (!isChromeAPIAvailable()) {
          console.debug("Extension: Chrome APIs not available - using cached config");
          // Use existing values if Chrome APIs aren't available
          if (!currentUrl || !currentKey || !currentModel) {
            console.warn("Extension: Missing configuration. Please configure the extension first.");
            return;
          }
        } else {
              try {
            const storedConfig = (await chrome.storage.local.get(["url", "key", "model"])) as StoredConfig;
            if (storedConfig.url) {
              currentUrl = storedConfig.url;
              url = storedConfig.url;
            }
            if (storedConfig.model) {
              currentModel = storedConfig.model;
              model = storedConfig.model;
            }
            
            // Decrypt API key if it exists
            if (storedConfig.key) {
              try {
                const decryptionResponse = await chrome.runtime.sendMessage({
                  action: "decryptApiKey",
                  encryptedApiKey: storedConfig.key
                });
                
                if (decryptionResponse.error) {
                  console.error("Extension: Failed to decrypt API key:", decryptionResponse.error);
                  currentKey = storedConfig.key; // Use as-is (backward compatibility)
                  key = storedConfig.key;
                } else {
                  currentKey = decryptionResponse.decrypted;
                  key = decryptionResponse.decrypted;
                }
              } catch (error) {
                if (isContextInvalidatedError(error)) {
                  // Expected when extension is reloaded - use debug level
                  console.debug("Extension: Chrome runtime API not available");
                } else {
                  console.error("Extension: Error decrypting API key:", error);
                }
                currentKey = storedConfig.key; // Use as-is (backward compatibility)
                key = storedConfig.key;
              }
            }
          } catch (error) {
            // Extension context might be invalidated - use existing values
            if (isContextInvalidatedError(error)) {
              // Expected when extension is reloaded - use debug level
              console.debug("Extension: Chrome storage API not available - using cached config");
            } else {
              console.log("Failed to get stored config:", error);
            }
          }
        }

        // Check if we have valid config
        if (!currentUrl || !currentKey || !currentModel) {
          console.warn("Extension: Missing configuration. Please configure the extension first.");
          return;
        }

        if (!isChromeAPIAvailable()) {
          console.debug("Extension: Chrome APIs not available - cannot get selection");
          return;
        }

        try {
          const response = await chrome.runtime.sendMessage({
            action: "getSelection",
          });

          if (response?.data ?? false) {
            // Initialize conversation
            responseQuery = response.data;
            responseText = "";
            thinkingText = "";
            isThinking = true; // Start in thinking mode
            thinkingExpanded = false;
            // Reassign to ensure reactivity
            conversationHistory = [
              {
                role: "system",
                content: "You are a helpful assistant with access to web search. For questions about current events, recent news, or information that may have changed after your training data, use web search to provide accurate, up-to-date information. Cite sources when using web search results. You can use markdown formatting (headers, lists, code blocks, bold, italic, etc.) to make your responses more readable and well-structured.",
              },
              {
                role: "user",
                content: response.data,
              },
            ];
            showResponse = true;
            isStreaming = true;
            userScrolledUp = false; // Reset scroll flag for new stream

            // Store the active element before making API call (optional - for writing to input)
            const activeElement = document.activeElement;
            let targetElement = null;
            
            if (activeElement && 
                (activeElement.tagName === "INPUT" || activeElement.tagName === "TEXTAREA")) {
              targetElement = activeElement;
            }
            
            let targetId = null;
            if (targetElement) {
              targetId = targetElement.id || `open-webui-target-${Date.now()}`;
              if (!targetElement.id) {
                targetElement.id = targetId;
              }
            }

            // Determine endpoint - check if model is OpenAI compatible
            // If models array is empty (API failed), default to ollama endpoint
            const isOpenAI = models.length > 0 
              ? (models.find((m) => m.id === currentModel)?.owned_by === "openai")
              : false;
            
            const endpoint = isOpenAI ? `${currentUrl}/openai` : `${currentUrl}/ollama/v1`;

            const [res, controller] = await generateOpenAIChatCompletion(
              currentKey,
              {
                model: currentModel,
                messages: conversationHistory,
                stream: true,
                features: {
                  web_search: true
                }
              },
              endpoint
            );

            if (res && res.ok) {
              const reader = res.body
                .pipeThrough(new TextDecoderStream())
                .pipeThrough(splitStream("\n"))
                .getReader();

              let responseComplete = false;
              while (true) {
                const { value, done } = await reader.read();
                if (done) {
                  break;
                }

                try {
                  let lines = value.split("\n");
                  for (const line of lines) {
                    if (line !== "") {
                      console.log(line);
                      if (line === "data: [DONE]") {
                        console.log("DONE");
                        responseComplete = true;
                      } else {
                        let data = JSON.parse(line.replace(/^data: /, ""));
                        console.log(data);

                        if ("request_id" in data) {
                          console.log(data.request_id);
                        } else {
                          const content = data.choices[0].delta.content ?? "";
                          // Update popup display
                          processStreamingContent(content);
                          
                          // Smart auto-scroll (only if user is near bottom)
                          setTimeout(() => {
                            smartScrollToBottom(responseContainer);
                          }, 0);
                          
                          // Optionally also write to input field if one was focused
                          if (targetId && content && isChromeAPIAvailable()) {
                            try {
                              await chrome.runtime.sendMessage({
                                action: "writeText",
                                text: content,
                                targetId: targetId,
                              });
                            } catch (writeError) {
                              // Silently fail - writing to input is optional
                              const errorMsg = writeError?.message || String(writeError);
                              if (!errorMsg.includes("Extension context invalidated") && 
                                  !errorMsg.includes("Cannot read properties of undefined")) {
                                console.debug("Extension: Could not write to input field:", writeError);
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                } catch (error) {
                  console.log(error);
                }
              }
              
              // Add assistant response to conversation history after streaming completes
              try {
                if (responseText) {
                  // Check if this response is already in history (avoid duplicates)
                  const alreadyInHistory = conversationHistory.some(
                    m => m.role === "assistant" && m.content === responseText
                  );
                  
                  if (!alreadyInHistory) {
                    // Reassign to trigger Svelte reactivity
                    conversationHistory = [...conversationHistory, {
                      role: "assistant",
                      content: responseText,
                    }];
                  }
                }
                isStreaming = false;
                // Clear responseText after adding to history so it doesn't interfere with display
                responseText = "";
                
                // Focus the follow-up input after response completes
                setTimeout(() => {
                  const inputElement = document.getElementById("open-webui-followup-input");
                  if (inputElement) {
                    inputElement.focus();
                  }
                }, 100);
              } catch (historyError) {
                // Even if adding to history fails, we should still show the response
                console.error("Extension: Error adding response to history:", historyError);
                isStreaming = false;
                // Don't clear responseText if we couldn't add it to history
                // This way it will still be displayed
              }
            } else {
              console.error("Extension: API request failed:", res);
              showResponse = false;
              isStreaming = false;
            }
          } else {
            // Silently ignore if no text is selected - user might have accidentally triggered the shortcut
          }
        } catch (error) {
          // Check if it's an extension context invalidated error
          if (isContextInvalidatedError(error)) {
            // Expected when extension is reloaded - use debug level
            console.debug("Extension: Chrome APIs not available - extension may have been reloaded");
            isStreaming = false;
            showResponse = false;
            return;
          }
          
          console.error("Extension: Error getting AI response:", error);
          const errorMsg = error?.message || String(error);
          // Check if it's a rate limit error
          if (errorMsg.includes("Rate limit exceeded")) {
            errorMessage = errorMsg;
            showError = true;
            showResponse = true; // Keep popup open to show error
            // Auto-hide error after 5 seconds
            setTimeout(() => {
              showError = false;
              errorMessage = "";
            }, 5000);
          }
          
          // If we have a response but hit an error, try to save it anyway
          if (responseText && isStreaming) {
            try {
              const alreadyInHistory = conversationHistory.some(
                m => m.role === "assistant" && m.content === responseText
              );
              if (!alreadyInHistory) {
                conversationHistory = [...conversationHistory, {
                  role: "assistant",
                  content: responseText,
                }];
              }
            } catch (saveError) {
              console.error("Extension: Could not save response:", saveError);
            }
          }
          isStreaming = false;
        }
      }
    };

    // Attach event listener immediately, before async operations
    document.addEventListener("keydown", down, { capture: true, passive: false });
    
    // Load configuration asynchronously (IIFE so onMount can return sync cleanup)
    (async () => {
    let _storageCache = null;
    const chromeApi = typeof globalThis !== 'undefined' ? (globalThis as any).chrome : undefined;
    const canLoadConfig = sidebarMode ? (chromeApi?.storage?.local != null) : isChromeAPIAvailable();

    if (!canLoadConfig) {
      console.debug("Extension: Chrome APIs not available for config loading");
      showConfig = true;
      return;
    }

    try {
      const storage = (chromeApi ?? (typeof globalThis !== 'undefined' ? (globalThis as any).chrome : null))?.storage?.local;
      _storageCache = storage ? await storage.get() : null;
    } catch (error) {
      if (isContextInvalidatedError(error)) {
        // Expected when extension is reloaded - use debug level
        console.debug("Extension: Chrome storage API not available - extension may have been reloaded");
      } else {
        console.error("Extension: Error getting config:", error);
      }
    }

    // Sidebar: wake worker with ping, then fast getSidebarInit (config only), then page content + models with retry.
    if (sidebarMode && canLoadConfig) {
      await pingSidebarWake();
      await new Promise((r) => setTimeout(r, 600));
      const initResult = await getSidebarInit();
      if (!initResult.error && (initResult.url != null || initResult.key != null || initResult.model != null)) {
        url = initResult.url ?? "";
        key = initResult.key ?? "";
        model = initResult.model ?? "";
        models = Array.isArray(initResult.models) ? initResult.models : [];
        sidebarPageContext = typeof initResult.pageContent === "string" ? initResult.pageContent : "";
        showConfig = !(url && key && model);
        if (url && key) {
          // Ping again before these calls to keep worker warm
          await pingSidebarWake();
          await new Promise((r) => setTimeout(r, 250));
              try {
            const pageResult = await getActiveTabPageContent();
            if (pageResult?.data && typeof pageResult.data === "string" && pageResult.data.trim()) {
              sidebarPageContext = pageResult.data;
            }
          } catch (_) {}
              try {
            models = await getModels(key, url);
          } catch (err) {
            console.debug("Extension: Failed to load models (non-critical):", err);
          }
        }
      } else {
        if (_storageCache) {
          url = _storageCache.url ?? "";
          model = _storageCache.model ?? "";
          if (_storageCache.key) {
            try {
              const decryptionResponse = await decryptApiKeyFromBackground(_storageCache.key);
              key = decryptionResponse?.error ? _storageCache.key : (decryptionResponse.decrypted ?? _storageCache.key);
            } catch (_) {
              key = _storageCache.key;
            }
          } else {
            key = "";
          }
          if (_storageCache.url && key && _storageCache.model) {
            showConfig = false;
            if (models.length === 0) {
              // Ping to keep worker warm before fetching models
              await pingSidebarWake();
              await new Promise((r) => setTimeout(r, 200));
              try {
                models = await getModels(key, _storageCache.url);
              } catch (err) {
                console.debug("Extension: Failed to load models (fallback):", err);
              }
            }
          } else {
            showConfig = true;
          }
        } else {
          showConfig = true;
        }
      }
    } else if (_storageCache) {
      url = _storageCache.url ?? "";
      model = _storageCache.model ?? "";
      if (_storageCache.key) {
        try {
          const decryptionResponse = await decryptApiKeyFromBackground(_storageCache.key);
          if (decryptionResponse?.error) {
            key = _storageCache.key;
          } else {
            key = decryptionResponse.decrypted ?? _storageCache.key;
          }
        } catch (_) {
          key = _storageCache.key;
        }
      } else {
        key = "";
      }
      if (_storageCache.url && key && _storageCache.model) {
        showConfig = false;
        if (models.length === 0) {
          // Ping to keep worker warm before fetching models
          await pingSidebarWake();
          await new Promise((r) => setTimeout(r, 200));
              try {
            models = await getModels(key, _storageCache.url);
          } catch (err) {
            console.debug("Extension: Failed to load models (non-critical):", err);
          }
        }
      } else {
        showConfig = true;
      }
    } else {
      showConfig = true;
    }
    })();
    
    return () => {
      document.removeEventListener("keydown", down);
      window.removeEventListener("open-webui-toggle-search", handleToggleEvent);
      window.removeEventListener("open-webui-summarize-page", handleSummarizeEvent as EventListener);
      window.removeEventListener("open-webui-explain-text", handleExplainTextEvent as EventListener);
      delete window.openWebUIToggleSearch;
    };
  });
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
{#if sidebarMode}
  <!-- Sidebar Mode: Full viewport layout -->
  <div
    class="tlwd-fixed tlwd-inset-0 tlwd-z-[9999999999] tlwd-bg-gray-900 tlwd-flex tlwd-flex-col tlwd-h-full"
  >
    <!-- Sidebar Header -->
    <div class="tlwd-flex tlwd-items-center tlwd-p-4 tlwd-border-b tlwd-border-gray-700">
      <div class="tlwd-flex tlwd-items-center tlwd-gap-2">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          stroke-width={2}
          stroke="currentColor"
          class="tlwd-size-6 tlwd-text-blue-500"
        >
          <path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456ZM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z" />
        </svg>
        <span class="tlwd-text-xl tlwd-font-semibold tlwd-text-white">Open WebUI</span>
      </div>
    </div>

    <!-- Sidebar Content -->
    <div class="tlwd-flex-1 tlwd-overflow-y-auto tlwd-p-4">
      {#if showConfig}
        <!-- Config Form -->
        <form on:submit={initHandler} class="tlwd-space-y-4">
          <div>
            <label class="tlwd-block tlwd-text-sm tlwd-text-gray-400 tlwd-mb-1">Open WebUI URL</label>
            <input
              type="url"
              bind:value={url}
              placeholder="http://localhost:8080"
              class="tlwd-w-full tlwd-px-3 tlwd-py-2 tlwd-bg-gray-800 tlwd-text-white tlwd-border tlwd-border-gray-600 tlwd-rounded-lg tlwd-outline-none focus:tlwd-border-blue-500"
              required
            />
          </div>
          <div>
            <label class="tlwd-block tlwd-text-sm tlwd-text-gray-400 tlwd-mb-1">API Key</label>
            <input
              type="password"
              bind:value={key}
              placeholder="Enter your API key"
              class="tlwd-w-full tlwd-px-3 tlwd-py-2 tlwd-bg-gray-800 tlwd-text-white tlwd-border tlwd-border-gray-600 tlwd-rounded-lg tlwd-outline-none focus:tlwd-border-blue-500"
              required
            />
          </div>
          <div>
            <label class="tlwd-block tlwd-text-sm tlwd-text-gray-400 tlwd-mb-1">Model</label>
            <div class="tlwd-flex tlwd-gap-2">
              <select
                bind:value={model}
                class="tlwd-flex-1 tlwd-px-3 tlwd-py-2 tlwd-bg-gray-800 tlwd-text-white tlwd-border tlwd-border-gray-600 tlwd-rounded-lg tlwd-outline-none focus:tlwd-border-blue-500"
                required
              >
                <option value="">Select a model</option>
                {#each models as m}
                  <option value={m.id}>{m.name ?? m.id}</option>
                {/each}
              </select>
              <button
                type="button"
                on:click={async () => {
                  if (!url) {
                    alert("Please enter a URL first");
                    return;
                  }
                  if (!key) {
                    alert("Please enter an API key first");
                    return;
                  }
                  try {
                    console.log("Loading models from:", url, "with key:", key ? "provided" : "missing");
                    models = await getModels(key, url);
                    console.log("Models loaded:", models.length);
                  } catch (e) {
                    console.log("Failed to load models:", e);
                    alert("Failed to load models: " + e.message);
                  }
                }}
                class="tlwd-px-3 tlwd-py-2 tlwd-bg-gray-700 hover:tlwd-bg-gray-600 tlwd-text-white tlwd-rounded-lg tlwd-text-sm"
                title="Load available models"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width={2} stroke="currentColor" class="tlwd-w-5 tlwd-h-5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
                </svg>
              </button>
            </div>
          </div>
          <button
            type="submit"
            class="tlwd-w-full tlwd-py-2 tlwd-bg-blue-600 hover:tlwd-bg-blue-700 tlwd-text-white tlwd-rounded-lg tlwd-font-medium"
          >
            Save & Start Chatting
          </button>
        </form>
      {:else}
        <!-- Chat Interface - Uses conversationHistory -->
        <div class="tlwd-space-y-4" bind:this={responseContainer}>
          {#each conversationHistory as msg}
            {#if msg.role !== 'system'}
              <div class="tlwd-flex" class:tlwd-justify-end={msg.role === 'user'}>
                <div
                  class="tlwd-max-w-[85%] tlwd-px-4 tlwd-py-3 tlwd-rounded-2xl tlwd-text-sm"
                  class:tlwd-bg-blue-600={msg.role === 'user'}
                  class:tlwd-text-white={msg.role === 'user'}
                  class:tlwd-bg-gray-800={msg.role !== 'user'}
                  class:tlwd-text-gray-200={msg.role !== 'user'}
                >
                  {#if msg.role === 'user'}
                    {msg.content}
                  {:else}
                    {@html renderMarkdown(msg.content)}
                  {/if}
                </div>
              </div>
            {/if}
          {/each}

          <!-- Streaming Response -->
          {#if isThinking && thinkingText}
            <div class="tlwd-flex tlwd-justify-start">
              <div class="tlwd-max-w-[85%] tlwd-px-4 tlwd-py-3 tlwd-bg-gray-800 tlwd-rounded-2xl tlwd-text-gray-200 tlwd-text-sm">
                <div class="tlwd-text-xs tlwd-text-gray-500 tlwd-mb-1">Thinking...</div>
                {@html renderMarkdown(thinkingText)}
              </div>
            </div>
          {/if}

          {#if isStreaming && !isThinking && responseText}
            <div class="tlwd-flex tlwd-justify-start">
              <div class="tlwd-max-w-[85%] tlwd-px-4 tlwd-py-3 tlwd-bg-gray-800 tlwd-rounded-2xl tlwd-text-gray-200 tlwd-text-sm">
                {@html renderMarkdown(responseText)}
                <span class="tlwd-inline-block tlwd-w-1.5 tlwd-h-4 tlwd-bg-gray-400 tlwd-ml-1 tlwd-animate-pulse"></span>
              </div>
            </div>
          {/if}

          {#if showError && errorMessage}
            <div class="tlwd-p-3 tlwd-bg-red-900/30 tlwd-border tlwd-border-red-700/50 tlwd-rounded-lg tlwd-text-red-300 tlwd-text-sm">
              {errorMessage}
            </div>
          {/if}
        </div>
      {/if}
    </div>

    <!-- Sidebar Input -->
    {#if !showConfig}
      <div class="tlwd-p-4 tlwd-border-t tlwd-border-gray-700">
        <form on:submit|preventDefault={submitHandler} class="tlwd-flex tlwd-gap-2">
          <input
            type="text"
            bind:value={searchValue}
            placeholder="Ask something..."
            disabled={isStreaming}
            class="tlwd-flex-1 tlwd-px-3 tlwd-py-2 tlwd-bg-gray-800 tlwd-text-white tlwd-border tlwd-border-gray-600 tlwd-rounded-lg tlwd-outline-none focus:tlwd-border-blue-500 disabled:tlwd-opacity-50"
          />
          <button
            type="submit"
            disabled={!searchValue.trim() || isStreaming}
            class="tlwd-px-4 tlwd-py-2 tlwd-bg-blue-600 hover:tlwd-bg-blue-700 tlwd-text-white tlwd-rounded-lg disabled:tlwd-opacity-50 disabled:tlwd-cursor-not-allowed"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width={2} stroke="currentColor" class="tlwd-w-5 tlwd-h-5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0 1 21.485 12 59.77 59.77 0 0 1 3.27 20.876L5.999 12zm0 0h7.5" />
            </svg>
          </button>
        </form>

        <!-- Action Buttons -->
        <div class="tlwd-flex tlwd-items-center tlwd-justify-between tlwd-mt-3">
          <button
            class="tlwd-text-xs tlwd-text-gray-400 hover:tlwd-text-gray-300"
            on:click={() => showConfig = true}
            type="button"
          >
            Configure
          </button>
          {#if conversationHistory.length > 0}
            <button
              class="tlwd-text-xs tlwd-text-blue-400 hover:tlwd-text-blue-300"
              on:click={continueInOpenWebUI}
              type="button"
            >
              Open in OpenWebUI
            </button>
          {/if}
        </div>
      </div>
    {/if}
  </div>
{:else if show}
  <div
    class="tlwd-fixed tlwd-top-0 tlwd-right-0 tlwd-left-0 tlwd-bottom-0 tlwd-w-full tlwd-min-h-screen tlwd-h-screen tlwd-flex tlwd-justify-center tlwd-z-[9999999999] tlwd-overflow-hidden tlwd-overscroll-contain"
    on:mousedown={() => {
      show = false;
    }}
  >
    {#if showConfig}
      <div class=" tlwd-m-auto tlwd-max-w-sm tlwd-w-full tlwd-pb-32">
        <div
          class="tlwd-w-full tlwd-flex tlwd-flex-col tlwd-justify-between tlwd-py-2.5 tlwd-px-3.5 tlwd-rounded-2xl tlwd-outline tlwd-outline-1 tlwd-outline-gray-850 tlwd-backdrop-blur-3xl tlwd-bg-gray-850/70 shadow-4xl modal-animation"
        >
          <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
          <form
            class="tlwd-text-neutral-100 tlwd-w-full tlwd-p-0 tlwd-m-0"
            on:submit={initHandler}
            on:mousedown={(e) => {
              e.stopPropagation();
            }}
            autocomplete="off"
            enctype="application/x-www-form-urlencoded"
          >
            <div class="tlwd-flex tlwd-items-center tlwd-gap-2 tlwd-w-full">
              <div class=" tlwd-flex tlwd-items-center">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke-width={2.5}
                  stroke="currentColor"
                  class="tlwd-size-5"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244"
                  />
                </svg>
              </div>
              <input
                id="open-webui-url-input"
                placeholder="Open WebUI URL"
                class="tlwd-p-0 tlwd-m-0 tlwd-text-xl tlwd-w-full tlwd-font-medium tlwd-bg-transparent tlwd-border-none placeholder:tlwd-text-gray-500 tlwd-text-neutral-100 tlwd-outline-none"
                bind:value={url}
                autocomplete="one-time-code"
                required
              />
            </div>
            <div
              class="tlwd-flex tlwd-items-center tlwd-gap-2 tlwd-w-full tlwd-mt-2"
            >
              <div class=" tlwd-flex tlwd-items-center">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke-width={2.5}
                  stroke="currentColor"
                  class="tlwd-size-5"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z"
                  />
                </svg>
              </div>
              <input
                placeholder="Open WebUI API Key"
                class="tlwd-p-0 tlwd-m-0 tlwd-text-xl tlwd-w-full tlwd-font-medium tlwd-bg-transparent tlwd-border-none placeholder:tlwd-text-gray-500 tlwd-text-neutral-100 tlwd-outline-none"
                bind:value={key}
                autocomplete="one-time-code"
                required
              />
              <button
                class=" tlwd-flex tlwd-items-center tlwd-bg-transparent tlwd-text-neutral-100 tlwd-cursor-pointer tlwd-p-0 tlwd-m-0 tlwd-outline-none tlwd-border-none"
                type="button"
                on:click={async () => {
                  if (url.endsWith("/")) {
                    url = url.slice(0, -1);
                  }

                  try {
                    models = await getModels(key, url);
                    // Clear any previous errors
                    showError = false;
                    errorMessage = "";
                  } catch (error) {
                    const errorMsg = error?.message || String(error);
                    if (errorMsg.includes("Rate limit exceeded")) {
                      errorMessage = errorMsg;
                      showError = true;
                      setTimeout(() => {
                        showError = false;
                        errorMessage = "";
                      }, 5000);
                    } else {
                      console.error("Extension: Error fetching models:", error);
                    }
                  }
                }}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke-width={2.5}
                  stroke="currentColor"
                  class="tlwd-size-5"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"
                  />
                </svg>
              </button>
            </div>

            {#if models && models.length > 0}
              <div
                class="tlwd-flex tlwd-items-center tlwd-gap-2 tlwd-w-full tlwd-mt-2"
              >
                <div class=" tlwd-flex tlwd-items-center">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke-width={2.5}
                    stroke="currentColor"
                    class="tlwd-size-5"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125"
                    />
                  </svg>
                </div>
                <select
                  id="open-webui-model-input"
                  class="tlwd-p-0 tlwd-m-0 tlwd-text-xl tlwd-w-full tlwd-font-medium tlwd-bg-gray-800/50 tlwd-border-none tlwd-text-neutral-100 tlwd-outline-none"
                  style="color: rgb(245 245 245) !important; background-color: rgba(31, 41, 55, 0.5) !important; -webkit-text-fill-color: rgb(245 245 245) !important;"
                  bind:value={model}
                  autocomplete="off"
                  required
                >
                  <option value="" style="color: rgb(245 245 245) !important; background-color: rgba(31, 41, 55, 0.8) !important;">Select a model</option>
                  {#each models as model}
                    <option value={model.id} style="color: rgb(245 245 245) !important; background-color: rgba(31, 41, 55, 0.8) !important;">{model.name ?? model.id}</option>
                  {/each}
                </select>
                <button
                  class=" tlwd-flex tlwd-items-center tlwd-bg-transparent tlwd-text-neutral-100 tlwd-cursor-pointer tlwd-p-0 tlwd-m-0 tlwd-outline-none tlwd-border-none"
                  type="submit"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke-width={2.5}
                    stroke="currentColor"
                    class="tlwd-size-5"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      d="m4.5 12.75 6 6 9-13.5"
                    />
                  </svg>
                </button>
              </div>
            {/if}
          </form>
        </div>
      </div>
    {:else}
      <div class=" tlwd-m-auto tlwd-max-w-xl tlwd-w-full tlwd-pb-32">
        <div
          class="tlwd-w-full tlwd-flex tlwd-flex-col tlwd-justify-between tlwd-py-2.5 tlwd-px-3.5 tlwd-rounded-2xl tlwd-outline tlwd-outline-1 tlwd-outline-gray-850 tlwd-backdrop-blur-3xl tlwd-bg-gray-850/70 shadow-4xl modal-animation"
        >
          <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
          <form
            class="tlwd-text-neutral-100 tlwd-w-full tlwd-p-0 tlwd-m-0"
            on:submit={submitHandler}
            on:mousedown={(e) => {
              e.stopPropagation();
            }}
            autocomplete="off"
            enctype="application/x-www-form-urlencoded"
          >
            <div class="tlwd-flex tlwd-items-center tlwd-gap-2 tlwd-w-full">
              <div class=" tlwd-flex tlwd-items-center">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke-width={2.5}
                  stroke="currentColor"
                  class="tlwd-size-5"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
                  />
                </svg>
              </div>
              <input
                id="open-webui-search-input"
                placeholder="Search Open WebUI"
                class="tlwd-p-0 tlwd-m-0 tlwd-text-xl tlwd-w-full tlwd-font-medium tlwd-bg-transparent tlwd-border-none placeholder:tlwd-text-gray-500 tlwd-text-neutral-100 tlwd-outline-none"
                bind:value={searchValue}
                autocomplete="one-time-code"
              />
            </div>

            <div
              class=" tlwd-flex tlwd-justify-end tlwd-gap-1 tlwd-items-center"
            >
              <div
                class="tlwd-text-right tlwd-text-[0.7rem] tlwd-p-0 tlwd-m-0 tlwd-text-neutral-300 tlwd-h-fit"
              >
                Press ⌘Space+Shift to toggle
              </div>
              <button
                class=" tlwd-h-fit tlwd-flex tlwd-items-center tlwd-bg-transparent tlwd-text-neutral-100 tlwd-cursor-pointer tlwd-p-0 tlwd-m-0 tlwd-outline-none tlwd-border-none"
                type="button"
                on:click={() => {
                  showConfig = true;
                }}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke-width={2.5}
                  stroke="currentColor"
                  class="tlwd-size-3"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z"
                  />
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
                  />
                </svg>
              </button>
            </div>
          </form>
        </div>
      </div>
    {/if}
  </div>
{/if}

<!-- ========================================================================
     ENHANCEMENT: Response Popup Modal
     ========================================================================
     Displays AI responses in a dedicated modal popup with:
     - Streaming response display with auto-scroll
     - Conversation history (user and assistant messages)
     - Follow-up question input
     - Copy conversation button
     - Continue in OpenWebUI button
     - Error message display for rate limits
     ======================================================================== -->
<!-- Response Popup -->
{#if showResponse}
  <div
    id="openwebui-response-modal"
    class="tlwd-fixed tlwd-top-0 tlwd-right-0 tlwd-left-0 tlwd-bottom-0 tlwd-w-full tlwd-min-h-screen tlwd-h-screen tlwd-flex tlwd-justify-center tlwd-z-[9999999999] tlwd-overflow-hidden tlwd-overscroll-contain"
  >
    <div
      class="openwebui-response-backdrop"
      role="button"
      tabindex="0"
      aria-label="Close response"
      on:click={closeResponseModal}
      on:keydown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          closeResponseModal();
        }
      }}
    ></div>
    <div class="openwebui-response-container tlwd-m-auto tlwd-max-w-4xl tlwd-w-full tlwd-pb-1 tlwd-px-2">
      <div
        role="dialog"
        aria-modal="true"
        class="tlwd-w-full tlwd-flex tlwd-flex-col tlwd-justify-between tlwd-py-1 tlwd-px-3 tlwd-rounded-lg tlwd-outline tlwd-outline-1 tlwd-outline-gray-850 tlwd-backdrop-blur-3xl tlwd-bg-gray-850/70 shadow-4xl modal-animation tlwd-max-h-[96vh] tlwd-overflow-hidden tlwd-flex tlwd-flex-col"
      >
        <!-- Header -->
        <div class="tlwd-flex tlwd-items-center tlwd-justify-between tlwd-mb-1 tlwd-pb-1.5 tlwd-border-b tlwd-border-gray-700">
          <div class="tlwd-flex tlwd-items-center tlwd-gap-1.5">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              stroke-width={2.5}
              stroke="currentColor"
              class="tlwd-size-4 tlwd-text-neutral-300"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456ZM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z"
              />
            </svg>
            <h3 class="tlwd-text-base tlwd-font-semibold tlwd-text-neutral-100">AI Response</h3>
          </div>
          <button
            class="tlwd-flex tlwd-items-center tlwd-bg-transparent tlwd-text-neutral-300 hover:tlwd-text-neutral-100 tlwd-cursor-pointer tlwd-p-1 tlwd-outline-none tlwd-border-none tlwd-transition-colors"
            on:click={closeResponseModal}
            type="button"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              stroke-width={2.5}
              stroke="currentColor"
              class="tlwd-size-5"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <!-- Conversation History -->
        <div 
          class="tlwd-relative tlwd-flex-1 tlwd-overflow-y-auto tlwd-pr-1 tlwd-mb-1.5"
          bind:this={responseContainer}
          on:scroll={(e) => {
            // Track if user manually scrolls up
            const container = e.currentTarget;
            if (container) {
              const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
              const scrollThreshold = 100;
              userScrolledUp = distanceFromBottom > scrollThreshold;
            }
          }}
        >
          <!-- Scroll to Bottom Button (shown when user scrolls up) -->
          {#if userScrolledUp && isStreaming}
            <div class="tlwd-absolute tlwd-bottom-4 tlwd-right-4 tlwd-z-10">
              <button
                type="button"
                class="tlwd-p-3 tlwd-bg-blue-600 hover:tlwd-bg-blue-700 tlwd-text-white tlwd-rounded-full tlwd-shadow-lg tlwd-transition-colors tlwd-outline-none tlwd-border-none tlwd-cursor-pointer"
                on:click={() => {
                  if (responseContainer) {
                    responseContainer.scrollTop = responseContainer.scrollHeight;
                    userScrolledUp = false;
                  }
                }}
                title="Scroll to bottom"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke-width={2.5}
                  stroke="currentColor"
                  class="tlwd-size-5"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M19.5 13.5L12 21m0 0l-7.5-7.5M12 21V3"
                  />
                </svg>
              </button>
            </div>
          {/if}
          {#each conversationHistory as message, index}
            {#if message.role === "user"}
              <div class="tlwd-mb-3">
                <div class="tlwd-text-sm tlwd-text-neutral-300 tlwd-mb-1 tlwd-font-medium">You:</div>
                <div class="tlwd-text-base tlwd-text-neutral-100 tlwd-bg-gray-800/50 tlwd-rounded-lg tlwd-p-3">
                  {message.content}
                </div>
              </div>
            {:else if message.role === "assistant"}
              <div class="tlwd-mb-3">
                <div class="tlwd-text-sm tlwd-text-neutral-300 tlwd-mb-1 tlwd-font-medium">Assistant:</div>
                <div class="tlwd-text-base tlwd-text-neutral-100 tlwd-leading-relaxed markdown-content">
                  {@html renderMarkdown(message.content)}
                </div>
              </div>
            {/if}
          {/each}
          
          <!-- Current streaming response (only show if streaming) -->
          {#if isStreaming}
            <div class="tlwd-mb-3">
              <div class="tlwd-text-sm tlwd-text-neutral-300 tlwd-mb-1 tlwd-font-medium">Assistant:</div>
              
              <!-- Thinking Indicator (shown when thinking is active or when streaming starts) -->
              {#if isThinking || thinkingText || (!responseText && isStreaming)}
                <div class="tlwd-mb-3">
                  <!-- Clickable Thinking Indicator -->
                  <button
                    type="button"
                    class="tlwd-w-full tlwd-flex tlwd-items-center tlwd-gap-2 tlwd-px-4 tlwd-py-3 tlwd-bg-gray-800/50 tlwd-border tlwd-border-gray-700 tlwd-rounded-lg tlwd-text-left tlwd-cursor-pointer tlwd-transition-colors hover:tlwd-bg-gray-800/70 tlwd-outline-none"
                    on:click={() => thinkingExpanded = !thinkingExpanded}
                  >
                    <div class="tlwd-flex tlwd-items-center tlwd-gap-2 tlwd-flex-1">
                      <div class="tlwd-flex tlwd-items-center tlwd-gap-1">
                        <div class="thinking-dots">
                          <span class="thinking-dot"></span>
                          <span class="thinking-dot"></span>
                          <span class="thinking-dot"></span>
                        </div>
                        <span class="tlwd-text-base tlwd-text-neutral-300 tlwd-font-medium">Thinking...</span>
                      </div>
                      {#if thinkingText}
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke-width={2}
                          stroke="currentColor"
                          class="tlwd-size-4 tlwd-text-neutral-400 tlwd-transition-transform"
                          class:tlwd-rotate-180={thinkingExpanded}
                        >
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            d="M19.5 8.25l-7.5 7.5-7.5-7.5"
                          />
                        </svg>
                      {/if}
                    </div>
                  </button>
                  
                  <!-- Expandable Thinking Text -->
                  {#if thinkingExpanded && thinkingText}
                    <div class="tlwd-mt-2 tlwd-px-4 tlwd-py-3 tlwd-bg-gray-900/50 tlwd-border tlwd-border-gray-700/50 tlwd-rounded-lg tlwd-text-base tlwd-text-neutral-300 tlwd-leading-relaxed tlwd-max-h-96 tlwd-overflow-y-auto">
                      {@html renderMarkdown(thinkingText)}
                    </div>
                  {/if}
                </div>
              {/if}
              
              <!-- Actual Response (shown after thinking or if no thinking) -->
              {#if responseText}
                <div class="tlwd-text-base tlwd-text-neutral-100 tlwd-leading-relaxed markdown-content">
                  {@html renderMarkdown(responseText)}
                  <span class="tlwd-inline-block tlwd-w-2 tlwd-h-4 tlwd-bg-neutral-300 tlwd-ml-1 tlwd-animate-pulse">|</span>
                </div>
              {/if}
            </div>
          {/if}
        </div>

        <!-- Error Message -->
        {#if showError && errorMessage}
          <div class="tlwd-mb-3 tlwd-p-3 tlwd-bg-red-900/20 tlwd-border tlwd-border-red-700/50 tlwd-rounded-lg">
            <div class="tlwd-flex tlwd-items-center tlwd-gap-2">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke-width={2.5}
                stroke="currentColor"
                class="tlwd-size-5 tlwd-text-red-400"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
                />
              </svg>
              <p class="tlwd-text-base tlwd-text-red-300">{errorMessage}</p>
            </div>
          </div>
        {/if}

        <!-- Follow-up Input -->
        <div class="tlwd-border-t tlwd-border-gray-700 tlwd-pt-2">
          <form
            on:submit|preventDefault={sendFollowUp}
            class="tlwd-flex tlwd-items-center tlwd-gap-2"
            enctype="application/x-www-form-urlencoded"
          >
            <input
              id="open-webui-followup-input"
              type="text"
              placeholder="Ask a follow-up question..."
              bind:value={followUpInput}
              disabled={isStreaming}
              class="tlwd-flex-1 tlwd-px-3 tlwd-py-2 tlwd-text-base tlwd-bg-gray-800/50 tlwd-border tlwd-border-gray-700 tlwd-rounded-lg tlwd-text-neutral-100 placeholder:tlwd-text-neutral-500 tlwd-outline-none focus:tlwd-border-gray-600 disabled:tlwd-opacity-50 disabled:tlwd-cursor-not-allowed"
              autocomplete="off"
            />
            <button
              type="submit"
              disabled={!followUpInput.trim() || isStreaming}
              class="tlwd-px-4 tlwd-py-2 tlwd-text-base tlwd-font-medium tlwd-bg-blue-600 hover:tlwd-bg-blue-700 disabled:tlwd-opacity-50 disabled:tlwd-cursor-not-allowed tlwd-text-white tlwd-rounded-lg tlwd-transition-colors tlwd-outline-none tlwd-border-none"
            >
              Send
            </button>
          </form>
          
          <!-- Footer -->
          <div class="tlwd-mt-2 tlwd-flex tlwd-items-center tlwd-justify-between">
            <div class="tlwd-text-sm tlwd-text-neutral-300">
              Press Escape to close
            </div>
            <div class="tlwd-flex tlwd-items-center tlwd-gap-3">
              <button
                class="tlwd-text-sm tlwd-text-blue-400 hover:tlwd-text-blue-300 disabled:tlwd-text-neutral-500 disabled:tlwd-opacity-50 disabled:tlwd-cursor-not-allowed tlwd-cursor-pointer tlwd-outline-none tlwd-border-none tlwd-bg-transparent tlwd-transition-colors tlwd-flex tlwd-items-center tlwd-gap-1"
                on:click={continueInOpenWebUI}
                type="button"
                disabled={conversationHistory.length === 0}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke-width={2}
                  stroke="currentColor"
                  class="tlwd-size-4"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"
                  />
                </svg>
                Continue in OpenWebUI
              </button>
              <button
                class="tlwd-text-sm tlwd-text-neutral-300 hover:tlwd-text-neutral-100 tlwd-cursor-pointer tlwd-outline-none tlwd-border-none tlwd-bg-transparent tlwd-transition-colors"
                on:click={() => {
                  // Copy full conversation to clipboard
                  const fullConversation = conversationHistory
                    .filter(m => m.role !== "system")
                    .map(m => `${m.role === "user" ? "You" : "Assistant"}: ${m.content}`)
                    .join("\n\n");
                  navigator.clipboard.writeText(fullConversation);
                }}
                type="button"
              >
                Copy conversation
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
{/if}
