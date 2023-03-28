document.getElementById("fetch-content").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  chrome.scripting.executeScript(
    {
      target: { tabId: tab.id },
      function: getContentArray,
    },
    (results) => {
      if (chrome.runtime.lastError) {
        document.getElementById("content").textContent =
          "DOIit only works at chat.openai.com/chat.";
        console.error(chrome.runtime.lastError);
        return;
      }
      const result = results[0];

      chrome.storage.sync.get("apiKey", (data) => {
        if (data.apiKey) {
          doit_chat(data.apiKey, result.result);
        } else {
          document.getElementById("content").textContent = "No API Key set.";
        }
      });
    }
  );
});

async function doit_chat(apiKey, data) {
  document.getElementById("content").textContent = "";

  // Send data to figshare and get the DOI
  const result = await sendToFigshare(apiKey, data);
}

function getContentArray() {
  // const main = document.getElementsByTagName("main")[0];
  // return main.innerHTML
  const divs = document.querySelectorAll("div.flex.flex-col.items-start");
  return {
    chat: Array.from(divs, (div) => div.textContent.trim()),
    URI: document.documentURI,
    lastModified: document.lastModified,
    title: document.head?.outerText,
  };
}

document.getElementById("settings").addEventListener("click", () => {
  document.getElementById("settings-modal").style.display = "block";
  chrome.storage.sync.get("apiKey", (data) => {
    document.getElementById("api-key").value = data.apiKey || "";
  });
  chrome.storage.sync.get("publish", (data) => {
    document.getElementById("publish").checked = data.publish || false;
  });
});

document.getElementById("close-settings").addEventListener("click", () => {
  document.getElementById("settings-modal").style.display = "none";
});

document.getElementById("save-api-key").addEventListener("click", () => {
  const apiKey = document.getElementById("api-key").value;
  const publish = document.getElementById("publish").checked;
  chrome.storage.sync.set({ apiKey, publish }, () => {
    document.getElementById("settings-modal").style.display = "none";
  });
  if (document.getElementById("content").textContent === "No API Key set.") {
    document.getElementById("content").textContent = "";
  }
});

async function sendToFigshare(apiKey, data) {
  const headers = new Headers();
  headers.append("Content-Type", "application/json");
  headers.append("Authorization", `Bearer ${apiKey}`);

  console.log("Sending to figshare...");
  // Create an article on figshare
  const createArticleResponse = await fetch(
    "https://api.figshare.com/v2/account/articles",
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        title: "ChatGPT conversation: ".concat(data?.title),
        description: "A conversation using OpenAI chat: ".concat(
          data?.lastModified
        ),
        defined_type: "dataset",
        categories: [28864],
        tags: ["ChatGPT", "DOIit", "Chrome Extension"],
      }),
    }
  ).catch((error) => {
    console.log(error);
    return error.message;
  });

  const response = await createArticleResponse;
  const article = await response.json();
  if (response.status === 403 || !response.ok) {
    document.getElementById(
      "content"
    ).textContent = `Error: ${article.message}`;
    return `Error: ${article.message}`;
  }

  if (article.entity_id == null) {
    document.getElementById("content").textContent =
      "Error: missing article id";
    return "Error: missing article id";
  }

  document.getElementById("content").textContent = "Uploading chat data...";

  const jsonData = JSON.stringify(data);
  const jsonBlob = new Blob([jsonData], {
    type: "application/json; charset=utf-8",
  });

  // Upload the JSON data to the created article
  const initUploadResponse = await fetch(
    `https://api.figshare.com/v2/account/articles/${article.entity_id.toString()}/files`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "chat.json",
        size: jsonBlob.size,
        md5: CryptoJS.MD5(jsonBlob).toString(),
        mimetype: "application/json",
      }),
    }
  );

  const initUploadData = await initUploadResponse.json();
  const { location } = initUploadData;

  const uploadRequest = await fetch(location, { headers });
  const uploadRequestData = await uploadRequest.json();
  const uploadFileId = uploadRequestData.id.toString();

  const partsRequest = await fetch(uploadRequestData.upload_url, { headers });
  const partsData = await partsRequest.json();

  const { parts } = partsData;

  for (let chunk = 0; chunk < parts.length; chunk++) {
    const start = parts[chunk].startOffset;
    const end = parts[chunk].endOffset;
    const chunkBlob = jsonBlob.slice(start, end);
    console.log(chunkBlob);
    const chunkArrayBuffer = await new Response(chunkBlob).arrayBuffer();
    console.log(chunkArrayBuffer);
    const chunkFormData = new FormData();
    chunkFormData.append("blob", chunkBlob, "chat.json");

    await fetch(`${uploadRequestData.upload_url}/${parts[chunk].partNo}`, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "multipart/form-data" },
      body: chunkFormData,
      processData: false,
      contentType: false,
    });
  }
  // Upload the JSON data to the created article
  const finalizeUpload = await fetch(
    `https://api.figshare.com/v2/account/articles/${article.entity_id.toString()}/files/${uploadFileId}`,
    {
      method: "POST",
      headers,
    }
  );
  if (finalizeUpload.status != 202 || !response.ok) {
    return "Error uploading file";
  }

  const result = await post_upload(article, headers);
  return result;
}

async function parseErrorResponse(resp) {
  const errStatus = resp.statusText;
  const errText = await resp.text();

  return `${errStatus}: ${errText}`;
}

async function post_upload(article, headers) {
  // Get the 'publish' value from Chrome storage
  chrome.storage.sync.get("publish", async (data) => {
    const { publish } = data;

    // Choose the URL to fetch based on the 'publish' value
    const url = publish
      ? `https://api.figshare.com/v2/account/articles/${article.entity_id.toString()}/publish`
      : `https://api.figshare.com/v2/account/articles/${article.entity_id.toString()}/private_links`;

    try {
      // Fetch the data from the chosen URL
      const response = await fetch(url, {
        method: "POST",
        headers,
      });

      // Handle the response, e.g., convert it to JSON
      let jsonData = await response.json();
      if (publish) {
        const articleloc = jsonData.location;
        const response1 = await fetch(
          `https://api.figshare.com/v2/account/articles/${article.entity_id.toString()}/reserve_doi`,
          {
            method: "POST",
            headers,
          }
        );
        // Handle the response, e.g., convert it to JSON
        jsonData = await response1.json();
        jsonData.html_location = articleloc;
      }
      // Perform actions with the fetched data
      const rez = publish
        ? `DOI: ${jsonData.doi}<p>${jsonData.html_location}`
        : `private link: <a href='${jsonData.html_location}'>${jsonData.html_location}</a>`;
      document.getElementById("content").innerHTML = rez;
      return rez;
    } catch (error) {
      // Handle any errors that occurred during the fetch
      console.error("Error fetching data:", error);
    }
  });
}
