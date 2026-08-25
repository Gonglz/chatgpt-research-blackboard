function sendMessageOnce(tabId, message) {
  return new Promise((resolve, reject) => {
    try {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }

        resolve(response);
      });
    } catch (error) {
      reject(error);
    }
  });
}

export function isMissingReceiverError(error) {
  return error?.message?.includes('Receiving end does not exist');
}

/**
 * Send a message to an existing manifest-declared content script.
 *
 * Research Blackboard intentionally does not dynamically inject content scripts:
 * doing so would require the broader `scripting` permission. If an extension
 * reload invalidated the page's old content-script context, the user must refresh
 * the ChatGPT tab. A short retry is kept for the normal document_idle startup race.
 */
export async function sendMessageToTabWithFallback(tabId, message, options = {}) {
  const { retryDelayMs = 300 } = options;

  try {
    return await sendMessageOnce(tabId, message);
  } catch (error) {
    if (!isMissingReceiverError(error)) {
      throw error;
    }

    if (retryDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }

    try {
      return await sendMessageOnce(tabId, message);
    } catch (retryError) {
      if (isMissingReceiverError(retryError)) {
        throw new Error('Research Blackboard content script is not active. Refresh the ChatGPT page after reloading or updating the extension.');
      }
      throw retryError;
    }
  }
}
