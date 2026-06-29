let session_id = "ui-session-" + Math.random().toString(36).substring(2, 9);

document.addEventListener("DOMContentLoaded", () => {
  // Elements
  const videoCardsContainer = document.getElementById("video-cards-container");
  const chatMessages = document.getElementById("chat-messages");
  const chatInput = document.getElementById("chat-input");
  const sendBtn = document.getElementById("send-btn");
  const refreshBtn = document.getElementById("refresh-btn");
  const pipelineHealthBar = document.getElementById("pipeline-health-bar");
  const quickPromptBtns = document.querySelectorAll(".quick-prompt-btn");

  // Fetch and render pipeline cards
  async function fetchPipelines() {
    try {
      const response = await fetch("/api/videos");
      if (!response.ok) throw new Error("Failed to fetch videos.");
      const videos = await response.json();
      renderVideos(videos);
      updateOverallHealth(videos);
    } catch (err) {
      console.error(err);
      videoCardsContainer.innerHTML = `
        <div class="loading-state">
          <p style="color: var(--red);">⚠️ Error loading pipeline data.</p>
        </div>
      `;
    }
  }

  // Render video cards
  function renderVideos(videos) {
    if (videos.length === 0) {
      videoCardsContainer.innerHTML = `<p>No active videos found.</p>`;
      return;
    }

    videoCardsContainer.innerHTML = "";
    
    videos.forEach(video => {
      // Find Publish date and check deadline
      const milestones = video.milestones || [];
      const publishMilestone = milestones.find(m => m.phase === "Publish");
      const publishDate = publishMilestone ? publishMilestone.target_date : null;
      const hardDeadline = video.hard_deadline;
      
      let isOverdue = false;
      let daysOverdue = 0;
      if (publishDate && hardDeadline) {
        const pub = new Date(publishDate);
        const hard = new Date(hardDeadline);
        if (pub > hard) {
          isOverdue = true;
          daysOverdue = Math.ceil((pub - hard) / (1000 * 60 * 60 * 24));
        }
      }

      // Check for AI / Sponsor violations
      let hasAIViolation = false;
      if (video.ai_allowed === 0 && video.ai_assets && video.ai_assets.length > 0) {
        // SafeBank has ai_allowed = 0. Check if any ElevenLabs / AI voiceover is present.
        const voiceover = video.ai_assets.find(a => a.model_used === "ElevenLabs" || a.type === "Voiceover");
        if (voiceover) {
          hasAIViolation = true;
        }
      }

      // Compute card health
      let healthClass = "on-track";
      let healthText = "🟢 On Track";
      if (isOverdue || hasAIViolation) {
        healthClass = "conflict";
        healthText = "🔴 Critical Conflict";
      } else if (video.ai_assets && video.ai_assets.length > 0) {
        healthClass = "warning-status";
        healthText = "🟡 Compliance Warning";
      }

      // Card Element
      const card = document.createElement("div");
      card.className = "video-card";
      
      // Top header info
      const cardTop = `
        <div class="card-top">
          <div class="video-info">
            <h3>${video.title}</h3>
            <div class="sponsor-badge">${video.sponsor_name ? `Sponsor: <strong>${video.sponsor_name}</strong>` : "No Sponsor"}</div>
          </div>
          <span class="status-badge ${healthClass}">${healthText}</span>
        </div>
      `;

      // Timeline grid
      let nodesHtml = "";
      const standardPhases = ["Scripting", "Filming", "Editing", "Thumbnail", "Final QC", "Publish"];
      
      standardPhases.forEach((phase, idx) => {
        const dbMilestone = milestones.find(m => m.phase === phase);
        const dateStr = dbMilestone ? dbMilestone.target_date : "TBD";
        const isDone = dbMilestone && dbMilestone.actual_date !== null;
        const isCurrent = video.status === phase;
        
        let nodeClass = "";
        if (isDone) nodeClass = "completed";
        else if (isCurrent) nodeClass = "current";
        
        // Highlight Publish in red if overdue
        if (phase === "Publish" && isOverdue) {
          nodeClass = "danger";
        }

        nodesHtml += `
          <div class="timeline-node ${nodeClass}">
            <div class="node-dot" title="${phase}"></div>
            <div class="node-label">${phase}</div>
            <div class="node-date">${dateStr}</div>
          </div>
        `;
      });

      const timelineTrack = `
        <div class="timeline-track-container">
          <div class="timeline-line"></div>
          <div class="timeline-nodes">
            ${nodesHtml}
          </div>
        </div>
      `;

      // Assets and Deadline
      let deadlineText = `Hard Deadline: <strong>${hardDeadline || "None"}</strong>`;
      let deadlineClass = "";
      if (isOverdue) {
        deadlineText = `🚨 Hard Deadline: <strong>${hardDeadline}</strong> (Overdue by ${daysOverdue} days!)`;
        deadlineClass = "danger-deadline";
      } else if (hardDeadline) {
        deadlineText = `Hard Deadline: <strong>${hardDeadline}</strong>`;
      }

      let assetChips = "";
      if (video.ai_assets && video.ai_assets.length > 0) {
        video.ai_assets.forEach(a => {
          assetChips += `<span class="asset-tag ai" title="${a.description || ''}">${a.model_used} (${a.type})</span>`;
        });
      } else {
        assetChips = `<span class="asset-tag">No AI Assets</span>`;
      }

      const cardBottom = `
        <div class="card-bottom">
          <div class="deadline-info ${deadlineClass}">
            ${deadlineText}
          </div>
          <div class="assets-summary">
            ${assetChips}
          </div>
        </div>
      `;

      card.innerHTML = cardTop + timelineTrack + cardBottom;
      videoCardsContainer.appendChild(card);
    });
  }

  // Update Overall Header Health Bar
  function updateOverallHealth(videos) {
    let hasConflict = false;
    let hasWarning = false;

    videos.forEach(video => {
      const milestones = video.milestones || [];
      const publishMilestone = milestones.find(m => m.phase === "Publish");
      const publishDate = publishMilestone ? publishMilestone.target_date : null;
      const hardDeadline = video.hard_deadline;
      
      const pub = publishDate ? new Date(publishDate) : null;
      const hard = hardDeadline ? new Date(hardDeadline) : null;
      
      const isOverdue = pub && hard && pub > hard;
      const hasAIViolation = video.ai_allowed === 0 && video.ai_assets && video.ai_assets.length > 0 &&
                             video.ai_assets.some(a => a.model_used === "ElevenLabs" || a.type === "Voiceover");
      
      if (isOverdue || hasAIViolation) {
        hasConflict = true;
      } else if (video.ai_assets && video.ai_assets.length > 0) {
        hasWarning = true;
      }
    });

    pipelineHealthBar.className = "health-bar";
    const textNode = pipelineHealthBar.querySelector(".health-text");

    if (hasConflict) {
      pipelineHealthBar.classList.add("critical");
      textNode.innerHTML = "Pipeline Health: 🔴 CRITICAL SCHEDULE CONFLICT";
    } else if (hasWarning) {
      pipelineHealthBar.classList.add("warning");
      textNode.innerHTML = "Pipeline Health: 🟡 COMPLIANCE WARNING";
    } else {
      pipelineHealthBar.classList.add("healthy");
      textNode.innerHTML = "Pipeline Health: 🟢 HEALTHY";
    }
  }

  // Send a message
  async function sendMessage(text) {
    if (!text.trim()) return;

    // Append User Message
    appendMessage(text, "user");
    chatInput.value = "";
    chatInput.style.height = "42px";

    // Show Typing Indicator
    const typingBubble = showTypingIndicator();
    chatMessages.scrollTop = chatMessages.scrollHeight;

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, session_id: session_id })
      });
      
      if (!response.ok) throw new Error("Failed to connect to agent.");
      const data = await response.json();
      
      // Remove Typing Indicator
      typingBubble.remove();

      // Append Agent response
      appendMessage(data.response, "agent");
      
      // Dynamic Refresh of pipeline visuals
      await fetchPipelines();

    } catch (err) {
      console.error(err);
      typingBubble.remove();
      appendMessage("⚠️ Error: Unable to communicate with the Pipeline Coordinator agent. Make sure the backend server is running.", "system");
    }
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  // Append a chat bubble
  function appendMessage(text, sender) {
    const messageDiv = document.createElement("div");
    messageDiv.className = `message ${sender}`;
    
    let bubbleContent = "";
    if (sender === "agent") {
      bubbleContent = parseMarkdown(text);
    } else {
      bubbleContent = `<p>${escapeHTML(text)}</p>`;
    }

    messageDiv.innerHTML = `
      <div class="msg-bubble">
        ${bubbleContent}
      </div>
    `;
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  // Show typing loader
  function showTypingIndicator() {
    const indicatorDiv = document.createElement("div");
    indicatorDiv.className = "message agent temp-typing";
    indicatorDiv.innerHTML = `
      <div class="msg-bubble">
        <div class="typing-indicator">
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
        </div>
      </div>
    `;
    chatMessages.appendChild(indicatorDiv);
    return indicatorDiv;
  }

  // Helper: Escape HTML to prevent injection
  function escapeHTML(str) {
    return str.replace(/[&<>'"]/g, 
      tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
    );
  }

  // Helper: Basic Markdown Parser for tables, lists, bold, and linebreaks
  function parseMarkdown(text) {
    let html = escapeHTML(text);

    // 1. Table Parsing
    const lines = html.split("\n");
    let inTable = false;
    let tableHtml = "<table>";
    let regularHtml = "";

    lines.forEach(line => {
      const isTableRow = line.trim().startsWith("|") && line.trim().endsWith("|");
      if (isTableRow) {
        if (line.includes("---")) {
          // Skip markdown divider line
          return;
        }
        if (!inTable) {
          inTable = true;
          tableHtml = "<table>";
        }
        
        const cells = line.split("|").slice(1, -1).map(c => c.trim());
        const isHeader = !regularHtml && tableHtml === "<table>"; // First row is header
        
        tableHtml += "<tr>";
        cells.forEach(cell => {
          // Restore basic markup inside table cells
          let cellText = cell
            .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
            .replace(/\*(.*?)\*/g, "<em>$1</em>");
          
          if (isHeader) {
            tableHtml += `<th>${cellText}</th>`;
          } else {
            tableHtml += `<td>${cellText}</td>`;
          }
        });
        tableHtml += "</tr>";
      } else {
        if (inTable) {
          inTable = false;
          tableHtml += "</table>";
          regularHtml += tableHtml;
        }
        regularHtml += line + "\n";
      }
    });
    if (inTable) {
      tableHtml += "</table>";
      regularHtml += tableHtml;
    }

    // 2. Bold, Lists, Headers, Verdict Colors
    html = regularHtml
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.*?)\*/g, "<em>$1</em>")
      .replace(/### (.*?)\n/g, "<h4>$1</h4>")
      .replace(/## (.*?)\n/g, "<h3>$1</h3>")
      .replace(/🟢 (GREEN)/gi, "<span style='color: var(--green); font-weight: 700;'>🟢 $1</span>")
      .replace(/🟡 (YELLOW)/gi, "<span style='color: var(--yellow); font-weight: 700;'>🟡 $1</span>")
      .replace(/🔴 (RED)/gi, "<span style='color: var(--red); font-weight: 700;'>🔴 $1</span>")
      .replace(/^\s*-\s+(.*?)$/gm, "<li>$1</li>");

    // Wrap groups of <li> tags in <ul>
    html = html.replace(/(<li>.*?<\/li>)+/gs, match => `<ul>${match}</ul>`);
    
    // Convert line breaks to <br> except inside tags
    html = html.trim().replace(/\n/g, "<br>");

    return html;
  }

  // Textarea auto-grow
  chatInput.addEventListener("input", function() {
    this.style.height = "42px";
    this.style.height = (this.scrollHeight > 120 ? 120 : this.scrollHeight) + "px";
  });

  // Event Listeners
  sendBtn.addEventListener("click", () => sendMessage(chatInput.value));
  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(chatInput.value);
    }
  });

  refreshBtn.addEventListener("click", fetchPipelines);

  // Quick Action buttons
  quickPromptBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      sendMessage(btn.textContent);
    });
  });

  // Initial Load
  fetchPipelines();
});
