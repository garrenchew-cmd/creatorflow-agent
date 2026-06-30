let session_id = "ui-session-" + Math.random().toString(36).substring(2, 9);
let allVideos = [];
let activeFilter = "all";

document.addEventListener("DOMContentLoaded", () => {
  // Elements
  const videoCardsContainer = document.getElementById("video-cards-container");
  const chatMessages = document.getElementById("chat-messages");
  const chatInput = document.getElementById("chat-input");
  const sendBtn = document.getElementById("send-btn");
  const refreshBtn = document.getElementById("refresh-btn");
  const pipelineHealthBar = document.getElementById("pipeline-health-bar");
  const quickPromptBtns = document.querySelectorAll(".quick-prompt-btn");
  
  // Drawer Elements
  const detailDrawer = document.getElementById("detail-drawer");
  const drawerCloseBtn = document.getElementById("drawer-close-btn");
  const drawerCloseOverlay = document.getElementById("drawer-close-overlay");
  const drawerVideoTitle = document.getElementById("drawer-video-title");
  const drawerBodyContent = document.getElementById("drawer-body-content");
  
  // Filter Chips
  const filterChips = document.querySelectorAll(".filter-chip");

  // Fetch and render pipeline cards
  async function fetchPipelines() {
    try {
      const response = await fetch("/api/videos");
      if (!response.ok) throw new Error("Failed to fetch videos.");
      allVideos = await response.json();
      applyFilterAndRender();
      renderAgenda(allVideos);
      updateOverallHealth(allVideos);
    } catch (err) {
      console.error(err);
      videoCardsContainer.innerHTML = `
        <div class="loading-state">
          <p style="color: var(--red);">⚠️ Error loading pipeline data.</p>
        </div>
      `;
    }
  }

  // Helper to determine video card health status
  function getVideoHealth(video) {
    const milestones = video.milestones || [];
    const publishMilestone = milestones.find(m => m.phase === "Publish");
    const publishDate = publishMilestone ? publishMilestone.target_date : null;
    const hardDeadline = video.hard_deadline;
    
    let isOverdue = false;
    if (publishDate && hardDeadline) {
      const pub = new Date(publishDate + "T00:00:00");
      const hard = new Date(hardDeadline + "T00:00:00");
      if (pub > hard) {
        isOverdue = true;
      }
    }

    let hasAIViolation = false;
    if (video.ai_allowed === 0 && video.ai_assets && video.ai_assets.length > 0) {
      const voiceover = video.ai_assets.find(a => a.model_used === "ElevenLabs" || a.type === "Voiceover");
      if (voiceover) {
        hasAIViolation = true;
      }
    }

    if (isOverdue || hasAIViolation) return "critical";
    if (video.ai_assets && video.ai_assets.length > 0) return "warning";
    return "healthy";
  }

  // Filter and render
  function applyFilterAndRender() {
    let filtered = allVideos;
    if (activeFilter === "critical") {
      filtered = allVideos.filter(v => getVideoHealth(v) === "critical");
    } else if (activeFilter === "warning") {
      filtered = allVideos.filter(v => getVideoHealth(v) === "warning");
    } else if (activeFilter === "healthy") {
      filtered = allVideos.filter(v => getVideoHealth(v) === "healthy");
    }
    renderVideos(filtered);
  }

  // Render Upcoming Agenda (Next 3 Days) relative to the earliest incomplete milestone
  function renderAgenda(videos) {
    const agendaContainer = document.getElementById("agenda-container");
    if (!agendaContainer) return;

    // Collect all incomplete milestones
    let incompleteMilestones = [];
    videos.forEach(video => {
      const milestones = video.milestones || [];
      milestones.forEach(m => {
        if (m.actual_date === null) {
          incompleteMilestones.push({
            videoTitle: video.title,
            videoHealth: getVideoHealth(video),
            phase: m.phase,
            targetDate: m.target_date
          });
        }
      });
    });

    if (incompleteMilestones.length === 0) {
      agendaContainer.innerHTML = `<p style="font-size: 0.8rem; color: var(--text-muted);">🎉 No upcoming tasks! All caught up.</p>`;
      return;
    }

    // Find earliest target date among incomplete milestones to act as simulated today anchor
    let dates = incompleteMilestones.map(m => new Date(m.targetDate + "T00:00:00"));
    let minDate = new Date(Math.min(...dates));

    // Threshold is anchor + 3 days (inclusive)
    let thresholdDate = new Date(minDate);
    thresholdDate.setDate(thresholdDate.getDate() + 3);

    // Filter milestones within the next 3 days
    let upcoming = incompleteMilestones.filter(m => {
      const d = new Date(m.targetDate + "T00:00:00");
      return d >= minDate && d <= thresholdDate;
    });

    // Sort by date ascending
    upcoming.sort((a, b) => new Date(a.targetDate + "T00:00:00") - new Date(b.targetDate + "T00:00:00"));

    if (upcoming.length === 0) {
      agendaContainer.innerHTML = `<p style="font-size: 0.8rem; color: var(--text-muted);">No tasks due in the next 3 days.</p>`;
      return;
    }

    agendaContainer.innerHTML = "";

    upcoming.forEach(item => {
      const agendaItem = document.createElement("div");
      
      // Determine health class
      let healthClass = "agenda-healthy";
      if (item.videoHealth === "critical") healthClass = "agenda-critical";
      else if (item.videoHealth === "warning") healthClass = "agenda-warning";

      // Relative due date label math
      const itemDate = new Date(item.targetDate + "T00:00:00");
      const diffTime = itemDate - minDate;
      const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
      
      let relativeLabel = item.targetDate;
      if (diffDays === 0) relativeLabel = "Today";
      else if (diffDays === 1) relativeLabel = "Tomorrow";
      else if (diffDays === 2) relativeLabel = "In 2 Days";
      else if (diffDays === 3) relativeLabel = "In 3 Days";

      agendaItem.className = `agenda-item ${healthClass}`;
      agendaItem.innerHTML = `
        <div class="agenda-info">
          <span class="agenda-video" title="${item.videoTitle}">${item.videoTitle}</span>
          <span class="agenda-phase">${item.phase}</span>
        </div>
        <span class="agenda-due">${relativeLabel}</span>
      `;
      agendaContainer.appendChild(agendaItem);
    });
  }

  // Render video cards
  function renderVideos(videos) {
    if (videos.length === 0) {
      videoCardsContainer.innerHTML = `
        <div class="loading-state" style="padding: 2rem;">
          <p style="color: var(--text-muted);">No projects match this status filter.</p>
        </div>
      `;
      return;
    }

    videoCardsContainer.innerHTML = "";
    
    videos.forEach(video => {
      const milestones = video.milestones || [];
      const publishMilestone = milestones.find(m => m.phase === "Publish");
      const publishDate = publishMilestone ? publishMilestone.target_date : null;
      const hardDeadline = video.hard_deadline;
      
      let isOverdue = false;
      let daysOverdue = 0;
      if (publishDate && hardDeadline) {
        const pub = new Date(publishDate + "T00:00:00");
        const hard = new Date(hardDeadline + "T00:00:00");
        if (pub > hard) {
          isOverdue = true;
          daysOverdue = Math.ceil((pub - hard) / (1000 * 60 * 60 * 24));
        }
      }

      // Check for AI / Sponsor violations
      let hasAIViolation = false;
      if (video.ai_allowed === 0 && video.ai_assets && video.ai_assets.length > 0) {
        const voiceover = video.ai_assets.find(a => a.model_used === "ElevenLabs" || a.type === "Voiceover");
        if (voiceover) {
          hasAIViolation = true;
        }
      }

      // Compute card health
      const health = getVideoHealth(video);
      let healthClass = "on-track";
      let cardColorClass = "card-healthy";
      let healthText = "🟢 On Track";
      
      if (health === "critical") {
        healthClass = "conflict";
        cardColorClass = "card-critical";
        healthText = "🔴 Conflict";
      } else if (health === "warning") {
        healthClass = "warning-status";
        cardColorClass = "card-warning";
        healthText = "🟡 Warning";
      }

      // Card Element
      const card = document.createElement("div");
      card.className = `video-card ${cardColorClass}`;
      card.style.cursor = "pointer";
      card.title = "Click to inspect audit details";
      
      // Open drawer on click
      card.addEventListener("click", () => openAuditDrawer(video));
      
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

      // Timeline grid mapping milestones dynamically
      let nodesHtml = "";
      milestones.forEach((m, idx) => {
        const phase = m.phase;
        const dateStr = m.target_date;
        const isDone = m.actual_date !== null;
        const isCurrent = video.status === phase;
        
        let nodeClass = "";
        if (isDone) nodeClass = "completed";
        else if (isCurrent) nodeClass = "current";
        
        if (phase === "Publish" && isOverdue) {
          nodeClass = "danger";
        }

        // Map phase names to short 3-letter codes
        const phaseMap = {
          "Scripting": "SCR",
          "Filming": "FIL",
          "Editing": "EDT",
          "Rough Cut": "RGH",
          "Sponsor Review": "REV",
          "Thumbnail": "TMB",
          "Final QC": "FQC",
          "Publish": "PUB"
        };
        const code = phaseMap[phase] || phase.substring(0, 3).toUpperCase();
        
        // Custom rich tooltip text
        let tooltipText = `${phase}: ${dateStr}`;
        if (isDone) tooltipText += " (Completed)";
        else if (isCurrent) tooltipText += " (Active Stage)";
        if (m.dependency_offset > 0) tooltipText += ` (Offset: +${m.dependency_offset}d)`;

        nodesHtml += `
          <div class="timeline-step-node ${nodeClass}">
            <div class="step-dot" title="${tooltipText}"></div>
            <div class="step-code">${code}</div>
          </div>
        `;
      });

      const timelineTrack = `
        <div class="timeline-track-container">
          <div class="timeline-step-row">
            <div class="timeline-step-line"></div>
            ${nodesHtml}
          </div>
        </div>
      `;

      // Assets and Deadline
      let deadlineText = `Due: ${hardDeadline || "None"}`;
      let deadlineClass = "";
      if (isOverdue) {
        deadlineText = `🚨 Slip: ${daysOverdue}d (Due ${hardDeadline})`;
        deadlineClass = "danger-deadline";
      } else if (hardDeadline) {
        deadlineText = `Due: ${hardDeadline}`;
      }

      let assetChips = "";
      if (video.ai_assets && video.ai_assets.length > 0) {
        video.ai_assets.forEach(a => {
          assetChips += `<span class="asset-pill ai-pill" title="${a.description || ''}">${a.model_used}</span>`;
        });
      } else {
        assetChips = `<span class="asset-pill">No AI Assets</span>`;
      }

      const cardBottom = `
        <div class="card-bottom">
          <div class="deadline-row ${deadlineClass}">
            ${deadlineText}
          </div>
          <div class="asset-pill-row">
            ${assetChips}
          </div>
        </div>
      `;

      card.innerHTML = cardTop + timelineTrack + cardBottom;
      videoCardsContainer.appendChild(card);
    });
  }

  // Open the Audit Detail Drawer
  function openAuditDrawer(video) {
    const health = getVideoHealth(video);
    drawerVideoTitle.textContent = video.title;
    
    // Compute details
    const milestones = video.milestones || [];
    const publishMilestone = milestones.find(m => m.phase === "Publish");
    const publishDate = publishMilestone ? publishMilestone.target_date : "N/A";
    
    let verdictClass = "green-verdict";
    let verdictText = "🟢 GREEN: On Track & Compliant";
    if (health === "critical") {
      verdictClass = "red-verdict";
      verdictText = "🔴 RED: Critical Conflict/Violation";
    } else if (health === "warning") {
      verdictClass = "yellow-verdict";
      verdictText = "🟡 YELLOW: Platform Warnings";
    }

    // Build Milestones Table HTML
    let milestoneRows = "";
    milestones.forEach(m => {
      milestoneRows += `
        <tr>
          <td><strong>${m.phase}</strong></td>
          <td>${m.target_date}</td>
          <td>${m.actual_date ? `🟢 ${m.actual_date}` : `<span style="color:var(--text-dark);">Incomplete</span>`}</td>
        </tr>
      `;
    });

    // Build AI Assets Table HTML
    let aiAssetsHtml = "";
    if (video.ai_assets && video.ai_assets.length > 0) {
      video.ai_assets.forEach(asset => {
        const hasHash = asset.c2pa_hash && asset.c2pa_hash !== "";
        const hashIcon = hasHash ? "🟢 Verified C2PA" : "🔴 Missing Provenance";
        
        aiAssetsHtml += `
          <div style="background: rgba(255,255,255,0.02); border: 1px solid var(--border-light); padding: 0.75rem; border-radius: 8px; margin-bottom: 0.5rem;">
            <div style="display:flex; justify-content:space-between; font-size:0.8rem; font-weight:700; margin-bottom:0.25rem;">
              <span>🤖 ${asset.model_used} (${asset.type})</span>
              <span style="font-size:0.75rem; color: ${hasHash ? 'var(--green)' : 'var(--red)'};">${hashIcon}</span>
            </div>
            <p style="font-size:0.75rem; color:var(--text-muted);">${asset.description || 'No description provided.'}</p>
            ${asset.c2pa_hash ? `<code style="font-size:0.65rem; background:rgba(0,0,0,0.3); padding:0.1rem 0.3rem; border-radius:4px; display:block; margin-top:0.25rem; overflow:hidden; text-overflow:ellipsis;">Hash: ${asset.c2pa_hash}</code>` : ''}
          </div>
        `;
      });
    } else {
      aiAssetsHtml = `<p style="font-size:0.8rem; color:var(--text-muted);">No generative AI assets logged for this video.</p>`;
    }

    // Check for specific warnings
    let warningNotes = "";
    if (health === "critical") {
      // Find hard deadline breach
      if (publishDate !== "N/A" && video.hard_deadline) {
        const pub = new Date(publishDate + "T00:00:00");
        const hard = new Date(video.hard_deadline + "T00:00:00");
        if (pub > hard) {
          const diff = Math.ceil((pub - hard) / (1000 * 60 * 60 * 24));
          warningNotes += `<li style="color: var(--red);">🚨 <strong>Hard Deadline Slipped:</strong> Upload date (${publishDate}) is ${diff} days past deadline (${video.hard_deadline}).</li>`;
        }
      }
      
      // Find AI Sponsor violation
      if (video.ai_allowed === 0 && video.ai_assets && video.ai_assets.length > 0) {
        const voiceover = video.ai_assets.find(a => a.model_used === "ElevenLabs" || a.type === "Voiceover");
        if (voiceover) {
          warningNotes += `<li style="color: var(--red);">🚨 <strong>AI Contract Breach:</strong> Sponsor <strong>${video.sponsor_name}</strong> bans AI voiceovers, but an ElevenLabs track was used.</li>`;
        }
      }
    }
    
    // Synthetic media tag check
    let disclosureAlert = "";
    if (video.ai_assets && video.ai_assets.length > 0) {
      const needsLabel = video.ai_assets.some(a => a.model_used === "ElevenLabs" || a.model_used === "Sora");
      if (needsLabel) {
        disclosureAlert = `
          <div style="background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.25); color: #fbbf24; padding: 0.75rem; border-radius: 8px; font-size: 0.75rem; font-weight:600;">
            ⚠️ ALTERED CONTENT LABEL REQUIRED: This project uses realistic synthetic media (ElevenLabs/Sora). You must toggle "Altered or Synthetic Content" when uploading to YouTube/TikTok.
          </div>
        `;
      }
    }

    // Render Drawer Content HTML
    drawerBodyContent.innerHTML = `
      <!-- Verdict Banner -->
      <div class="drawer-verdict-banner ${verdictClass}">
        ${verdictText}
      </div>
      
      ${disclosureAlert}

      <!-- Metadata Section -->
      <div class="drawer-section">
        <h3>Project Information</h3>
        <div class="drawer-meta-grid">
          <span class="drawer-meta-label">Sponsor:</span>
          <span class="drawer-meta-val">${video.sponsor_name || 'None'}</span>
          
          <span class="drawer-meta-label">Hard Deadline:</span>
          <span class="drawer-meta-val" style="color:${health === 'critical' ? 'var(--red)' : '#fff'};">${video.hard_deadline || 'None'}</span>
          
          <span class="drawer-meta-label">Review Window:</span>
          <span class="drawer-meta-val">${video.review_window_days ? `${video.review_window_days} Days Required` : 'None'}</span>
        </div>
      </div>

      <!-- Actionable Violations list -->
      ${warningNotes ? `
      <div class="drawer-section">
        <h3 style="color: var(--red);">Critical Violations</h3>
        <ul style="padding-left:1rem; display:flex; flex-direction:column; gap:0.5rem; font-size:0.8rem;">
          ${warningNotes}
        </ul>
      </div>
      ` : ''}

      <!-- Milestones List -->
      <div class="drawer-section">
        <h3>Milestone Timeline</h3>
        <table style="width:100%;">
          <thead>
            <tr>
              <th>Milestone</th>
              <th>Target Date</th>
              <th>Actual Date</th>
            </tr>
          </thead>
          <tbody>
            ${milestoneRows}
          </tbody>
        </table>
      </div>

      <!-- Generative AI Log -->
      <div class="drawer-section">
        <h3>AI Asset Audit Log</h3>
        ${aiAssetsHtml}
      </div>
    `;

    detailDrawer.classList.add("open");
  }

  // Close Drawer
  function closeDrawer() {
    detailDrawer.classList.remove("open");
  }
  drawerCloseBtn.addEventListener("click", closeDrawer);
  drawerCloseOverlay.addEventListener("click", closeDrawer);

  // Update Overall Header Health Bar
  function updateOverallHealth(videos) {
    let hasConflict = false;
    let hasWarning = false;

    videos.forEach(video => {
      const health = getVideoHealth(video);
      if (health === "critical") {
        hasConflict = true;
      } else if (health === "warning") {
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

  // Filter Chips event binding
  filterChips.forEach(chip => {
    chip.addEventListener("click", () => {
      filterChips.forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      activeFilter = chip.getAttribute("data-filter");
      applyFilterAndRender();
    });
  });

  // Send a message
  async function sendMessage(text) {
    if (!text.trim()) return;

    // Append User Message
    appendMessage(text, "user");
    chatInput.value = "";
    chatInput.style.height = "44px";

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
    
    // Auto-detect prompt injection block message to style as system warning
    let isSecurityAlert = text.includes("Security Alert") || text.includes("injection attempt blocked");
    let bubbleSender = sender;
    if (isSecurityAlert) {
      bubbleSender = "system";
    }

    messageDiv.className = `message ${bubbleSender}`;
    
    let bubbleContent = "";
    if (sender === "agent" && !isSecurityAlert) {
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
    this.style.height = "44px";
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
