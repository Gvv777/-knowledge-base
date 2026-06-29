var state = {
  documents: [],
  tab: 'browse',
  previewId: null
};

var chatHistory = [];

function escapeHtml(str) {
  var div = document.createElement('div');
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

function formatDate(iso) {
  var d = new Date(iso);
  var pad = function (n) { return n < 10 ? '0' + n : n; };
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function typeTag(type) {
  return '<span class="tag tag-' + type + '">.' + type + '</span>';
}

function notify(msg, type) {
  var el = document.getElementById('notification');
  el.textContent = msg;
  el.className = 'notification ' + type;
  clearTimeout(el._timer);
  el._timer = setTimeout(function () { el.style.display = 'none'; }, 3000);
}

// ==================== Markdown 渲染 ====================

function renderMarkdown(text) {
  var html = escapeHtml(text);
  // 代码块 ```...```
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, function (_, lang, code) {
    return '<pre><code>' + code.trim() + '</code></pre>';
  });
  // 行内代码 `...`
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  // **加粗**
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // *斜体*
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  // 无序列表 - 开头
  var lines = html.split('\n');
  var inList = false;
  var out = [];
  lines.forEach(function (line) {
    if (/^- /.test(line) || /^\* /.test(line)) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push('<li>' + line.replace(/^[-*] /, '') + '</li>');
    } else {
      if (inList) { out.push('</ul>'); inList = false; }
      out.push(line);
    }
  });
  if (inList) out.push('</ul>');
  html = out.join('\n');
  // 数字列表
  lines = html.split('\n');
  inList = false;
  out = [];
  lines.forEach(function (line) {
    if (/^\d+\. /.test(line)) {
      if (!inList) { out.push('<ol>'); inList = true; }
      out.push('<li>' + line.replace(/^\d+\. /, '') + '</li>');
    } else {
      if (inList) { out.push('</ol>'); inList = false; }
      out.push(line);
    }
  });
  if (inList) out.push('</ol>');
  html = out.join('\n');
  // 分段：连续两个换行
  html = html.replace(/\n\n/g, '</p><p>');
  // 单个换行转 <br>
  html = html.replace(/\n/g, '<br>');
  // 包在段落里
  if (!/^<(ul|ol|pre|p)/.test(html)) {
    html = '<p>' + html + '</p>';
  }
  html = html.replace(/<p><\/p>/g, '');
  return html;
}

// ==================== 打字机效果 ====================

function typeText(el, text, speed, callback) {
  var html = renderMarkdown(text);
  var i = 0;
  el.innerHTML = '';
  var timer = setInterval(function () {
    i += 2;
    if (i >= html.length) {
      el.innerHTML = html;
      clearInterval(timer);
      if (callback) callback();
    } else {
      el.innerHTML = html.slice(0, i);
    }
  }, speed || 16);
  return timer;
}

// ==================== API ====================

async function api(method, url, body) {
  var opts = { method: method, headers: {} };
  if (body instanceof FormData) {
    opts.body = body;
  } else if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  var res = await fetch(url, opts);
  if (!res.ok) {
    var err = await res.json().catch(function () { return { error: res.statusText }; });
    throw new Error(err.error || 'request failed');
  }
  return res.json();
}

// ==================== document list ====================

function renderDocs() {
  var list = document.getElementById('docList');
  var total = document.getElementById('docTotal');

  total.textContent = state.documents.length > 0
    ? '共 ' + state.documents.length + ' 篇'
    : '';

  if (state.documents.length === 0) {
    list.innerHTML = '<div class="empty-state">知识库为空，选择文件后自动上传</div>';
    return;
  }

  var html = '';
  state.documents.forEach(function (doc) {
    var isPreview = state.previewId === doc.id;
    html += '<div class="doc-item" data-id="' + doc.id + '">'
      + '<div class="doc-icon">' + (doc.type === 'pdf' ? '[PDF]' : doc.type === 'md' ? '[MD]' : '[TXT]') + '</div>'
      + '<div class="doc-info">'
      + '<div class="doc-title">' + escapeHtml(doc.title) + '</div>'
      + '<div class="doc-meta">' + typeTag(doc.type) + ' ' + formatSize(doc.size) + ' / ' + formatDate(doc.date) + '</div>'
      + '</div>'
      + '<div class="doc-actions">'
      + '<button class="btn btn-sm btn-outline preview-btn" data-id="' + doc.id + '">' + (isPreview ? '收起' : '预览') + '</button>'
      + '<button class="btn btn-sm btn-danger delete-btn" data-id="' + doc.id + '">删除</button>'
      + '</div>'
      + '</div>'
      + '<div class="preview' + (isPreview ? ' show' : '') + '" id="preview-' + doc.id + '">'
      + '<div class="preview-content" id="previewContent-' + doc.id + '">加载中...</div>'
      + '</div>';
  });
  list.innerHTML = html;

  if (state.previewId) {
    loadPreview(state.previewId);
  }
}

function loadPreview(id) {
  var el = document.getElementById('previewContent-' + id);
  if (!el) return;
  el.textContent = '加载中...';
  api('GET', '/api/documents/' + id).then(function (data) {
    el.textContent = data.document.content || '(空)';
  }).catch(function (err) {
    el.textContent = '加载失败: ' + err.message;
  });
}

function loadDocs() {
  api('GET', '/api/documents').then(function (data) {
    state.documents = data.documents;
    renderDocs();
  }).catch(function (err) {
    notify(err.message, 'error');
  });
}

// ==================== upload (auto) ====================

function uploadFiles() {
  var input = document.getElementById('fileInput');
  var files = input.files;
  if (files.length === 0) return;

  var status = document.getElementById('uploadStatus');
  status.textContent = '正在上传 ' + files.length + ' 个文件...';

  var formData = new FormData();
  for (var i = 0; i < files.length; i++) {
    formData.append('files', files[i]);
  }

  api('POST', '/api/upload', formData).then(function (data) {
    var ok = data.results.filter(function (r) { return !r.error; }).length;
    var err = data.results.filter(function (r) { return r.error; }).length;
    status.textContent = '上传完成: ' + ok + ' 成功' + (err ? ', ' + err + ' 失败' : '');
    input.value = '';
    loadDocs();
    notify('上传完成, ' + ok + ' 篇文档已加入知识库', 'success');
  }).catch(function (err) {
    status.textContent = '上传失败: ' + err.message;
    notify(err.message, 'error');
  });
}

// ==================== 对话历史 ====================

function saveChatHistory() {
  try {
    localStorage.setItem('kb_chat_history', JSON.stringify(chatHistory));
  } catch (e) {}
}

function loadChatHistory() {
  try {
    var data = localStorage.getItem('kb_chat_history');
    if (data) {
      chatHistory = JSON.parse(data);
      return true;
    }
  } catch (e) {}
  return false;
}

function renderChatHistory() {
  var container = document.getElementById('searchResults');
  var welcome = container.querySelector('.message.welcome');
  container.innerHTML = '';

  if (chatHistory.length === 0) {
    if (welcome) container.appendChild(welcome);
    return;
  }

  chatHistory.forEach(function (msg) {
    var div = document.createElement('div');
    div.className = 'message ' + msg.type;
    div.innerHTML = msg.html;
    container.appendChild(div);
  });
  container.scrollTop = container.scrollHeight;
}

// ==================== chat / search ====================

function addMessage(type, html) {
  var container = document.getElementById('searchResults');
  var div = document.createElement('div');
  div.className = 'message ' + type;
  div.innerHTML = html;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  // 保存到历史
  chatHistory.push({ type: type, html: html });
  saveChatHistory();
}

function clearChat() {
  chatHistory = [];
  saveChatHistory();
  var container = document.getElementById('searchResults');
  container.innerHTML = '';
  addMessage('welcome', '<div class="msg-content">输入关键词或问题开始搜索</div>');
}

function doSend() {
  var input = document.getElementById('aiInput');
  var q = input.value.trim();
  if (!q) return;
  input.value = '';

  var welcome = document.querySelector('.message.welcome');
  if (welcome) welcome.style.display = 'none';

  // 用户消息
  addMessage('user', '<div class="msg-content">' + escapeHtml(q) + '</div>');

  // 关键词搜索 loading
  var loadingId = 'loading-' + Date.now();
  addMessage('bot', '<div class="msg-content" id="' + loadingId + '"><div class="ai-loading">搜索中</div></div>');

  api('GET', '/api/search?q=' + encodeURIComponent(q)).then(function (kwData) {
    var kwHtml = '';
    if (kwData.results && kwData.results.length > 0) {
      kwHtml += '<div class="result-meta" style="margin-bottom:6px;">找到 ' + kwData.total + ' 篇相关文档</div>';
      kwData.results.slice(0, 5).forEach(function (r) {
        kwHtml += '<div class="result-item kw-item" style="margin-bottom:8px;">'
          + '<div class="kw-header">'
          + '<span class="result-title">[' + r.type.toUpperCase() + '] ' + escapeHtml(r.title) + '</span>'
          + '<span class="kw-toggle">展开</span>'
          + '</div>'
          + '<div class="kw-snippets" style="display:none;">';
        if (r.snippets && r.snippets.length > 0) {
          r.snippets.slice(0, 2).forEach(function (s) {
            kwHtml += '<div class="result-snippet" style="margin-top:4px;">...'
              + s.replace(/🔍/g, '<span class="hl">').replace(/🔍/g, '</span>')
              + '...</div>';
          });
        }
        kwHtml += '</div></div>';
      });
    } else {
      kwHtml = '<div class="result-meta" style="color:#666;">关键词未找到匹配文档</div>';
    }

    var loadingEl = document.getElementById(loadingId);
    if (loadingEl) {
      loadingEl.closest('.message').querySelector('.msg-content').innerHTML = '<div class="msg-label">关键词匹配</div>' + kwHtml;
      // 折叠展开功能
      loadingEl.closest('.message').querySelectorAll('.kw-header').forEach(function (hdr) {
        hdr.addEventListener('click', function () {
          var snippets = hdr.nextElementSibling;
          if (snippets && snippets.classList.contains('kw-snippets')) {
            var isHidden = snippets.style.display === 'none';
            snippets.style.display = isHidden ? 'block' : 'none';
            hdr.querySelector('.kw-toggle').textContent = isHidden ? '收起' : '展开';
          }
        });
      });
    }

    // AI 搜索
    var aiLoadingId = 'ai-loading-' + Date.now();
    addMessage('bot', '<div class="msg-content" id="' + aiLoadingId + '"><div class="ai-loading">AI 分析中</div></div>');

    api('POST', '/api/search/ai', { q: q }).then(function (aiData) {
      var aiEl = document.getElementById(aiLoadingId);
      if (aiEl) {
        var parent = aiEl.closest('.message');
        if (parent) parent.remove();
        // 也从历史删除
        chatHistory.pop();
      }

      var sourcesHtml = '';
      if (aiData.sources && aiData.sources.length > 0) {
        sourcesHtml = '<div class="msg-sources">参考来源: ';
        aiData.sources.forEach(function (s, idx) {
          sourcesHtml += '<span class="source-link" data-id="' + s.id + '" data-title="' + escapeHtml(s.title) + '">'
            + '[' + s.type.toUpperCase() + '] ' + escapeHtml(s.title) + '</span>';
        });
        sourcesHtml += '</div>';
      }

      // 用打字机效果展示 AI 回答
      var msgId = 'ai-msg-' + Date.now();
      var answerHtml = '<div class="msg-content" id="' + msgId + '">'
        + '<div class="msg-label">AI 回答</div>'
        + '<div class="ai-text"></div>'
        + sourcesHtml
        + '</div>';

      // 先加到聊天，获取 DOM 引用后再打字
      var container = document.getElementById('searchResults');
      var tempDiv = document.createElement('div');
      tempDiv.className = 'message bot';
      tempDiv.innerHTML = answerHtml;
      container.appendChild(tempDiv);
      container.scrollTop = container.scrollHeight;
      chatHistory.push({ type: 'bot', html: answerHtml });
      saveChatHistory();

      var textEl = tempDiv.querySelector('.ai-text');
      typeText(textEl, aiData.answer, 12);

      // 来源点击事件
      tempDiv.querySelectorAll('.source-link').forEach(function (link) {
        link.addEventListener('click', function () {
          var id = this.dataset.id;
          var title = this.dataset.title;
          // 切换到浏览 tab 并打开预览
          switchTab('browse');
          state.previewId = id;
          renderDocs();
          notify('已打开: ' + title, 'info');
        });
      });
    }).catch(function (err) {
      var aiEl = document.getElementById(aiLoadingId);
      if (aiEl) {
        var parent = aiEl.closest('.message');
        if (parent) parent.remove();
        chatHistory.pop();
      }
      addMessage('bot', '<div class="msg-content" style="border-color:rgba(200,60,80,0.3);">'
        + '<div class="msg-label" style="color:#e08090;">AI 请求失败</div>'
        + '<div>' + escapeHtml(err.message) + '</div>'
        + '</div>');
    });
  }).catch(function (err) {
    var loadingEl = document.getElementById(loadingId);
    if (loadingEl) {
      var parent = loadingEl.closest('.message');
      if (parent) parent.remove();
      chatHistory.pop();
    }
    addMessage('bot', '<div class="msg-content" style="border-color:rgba(200,60,80,0.3);">'
      + '<div class="msg-label" style="color:#e08090;">搜索失败</div>'
      + '<div>' + escapeHtml(err.message) + '</div>'
      + '</div>');
  });
}

// ==================== tab switch ====================

function switchTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.tabs button').forEach(function (btn) {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  document.getElementById('tabBrowse').style.display = tab === 'browse' ? 'block' : 'none';
  document.getElementById('tabSearch').style.display = tab === 'search' ? 'block' : 'none';
}

// ==================== events ====================

document.addEventListener('DOMContentLoaded', function () {
  loadDocs();

  // 加载对话历史
  if (loadChatHistory() && chatHistory.length > 0) {
    renderChatHistory();
  }

  document.querySelectorAll('.tabs button').forEach(function (btn) {
    btn.addEventListener('click', function () { switchTab(btn.dataset.tab); });
  });

  document.getElementById('fileInput').addEventListener('change', function () {
    if (this.files.length > 0) uploadFiles();
  });

  document.getElementById('docList').addEventListener('click', function (e) {
    var target = e.target;

    if (target.classList.contains('delete-btn')) {
      var id = target.dataset.id;
      if (!confirm('确定删除此文档?')) return;
      api('DELETE', '/api/documents/' + id).then(function () {
        if (state.previewId === id) state.previewId = null;
        loadDocs();
        notify('文档已删除', 'info');
      }).catch(function (err) {
        notify(err.message, 'error');
      });
      return;
    }

    if (target.classList.contains('preview-btn')) {
      var id = target.dataset.id;
      state.previewId = state.previewId === id ? null : id;
      renderDocs();
    }
  });

  document.getElementById('aiInput').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      doSend();
    }
  });

  document.getElementById('sendBtn').addEventListener('click', doSend);

  // 清除对话
  document.getElementById('clearChatBtn').addEventListener('click', clearChat);
});
