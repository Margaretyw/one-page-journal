const STORAGE_KEY = "one-page-journal.v1";
const DB_NAME = "one-page-journal-media";
const DB_STORE = "images";
const DB_VERSION = 1;

const MOODS = ["明亮", "平静", "忙碌", "疲惫"];
const EXPENSE_CATEGORIES = ["餐饮", "交通", "购物", "生活", "学习", "其他"];
const QUOTES = [
  "认真生活，也认真收藏生活。",
  "普通的一天，也值得有一页自己的位置。",
  "把日子写下来，它就有了形状。",
  "记录不是为了完美，而是为了不遗忘。",
  "一点一点地过，一字一句地留。",
  "生活的纹理，常藏在不起眼的小事里。",
  "今天不必惊天动地，真实就很好。",
  "所遇、所思、所喜，都可以成为一页。",
  "慢一点写，才听得见自己的声音。",
  "每一页空白，都在等今天发生。",
];

const state = {
  data: createEmptyData(),
  viewDate: toDateKey(new Date()),
  calendarMonth: startOfMonth(new Date()),
  saveTimer: null,
  toastTimer: null,
  mediaType: "text",
  pendingImageFile: null,
  pendingPreviewUrl: null,
  archiveFilter: "all",
  archiveQuery: "",
  imageUrlCache: new Map(),
};

let databasePromise = null;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

document.addEventListener("DOMContentLoaded", init);

function init() {
  const loaded = loadData();
  state.data = loaded.data;
  state.viewDate = toDateKey(new Date());
  state.calendarMonth = startOfMonth(parseDateKey(state.viewDate));

  bindEvents();
  renderAll();

  if (loaded.hadError) {
    showToast("原有数据读取失败，已打开一个空白手账。请先不要录入新内容。");
  }

  if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

function bindEvents() {
  $("#prevMonth").addEventListener("click", () => moveCalendarMonth(-1));
  $("#nextMonth").addEventListener("click", () => moveCalendarMonth(1));
  $("#goToday").addEventListener("click", goToToday);
  $("#brandHome").addEventListener("click", (event) => {
    event.preventDefault();
    goToToday();
  });

  $("#calendarGrid").addEventListener("click", (event) => {
    const button = event.target.closest("[data-date]");
    if (!button) return;
    switchDate(button.dataset.date);
  });

  $("#prevDay").addEventListener("click", () => changeDay(-1));
  $("#nextDay").addEventListener("click", () => changeDay(1));
  $("#checkinButton").addEventListener("click", toggleCheckin);
  $("#moodOptions").addEventListener("click", handleMoodClick);

  $$("[data-day-field]").forEach((field) => {
    field.addEventListener("input", (event) => {
      const day = ensureDay(state.viewDate);
      setByPath(day, event.currentTarget.dataset.dayField, event.currentTarget.value);
      day.updatedAt = new Date().toISOString();
      queueSave();
    });
  });

  $("#addExpense").addEventListener("click", addExpense);
  $("#expenseList").addEventListener("input", updateExpense);
  $("#expenseList").addEventListener("change", updateExpense);
  $("#expenseList").addEventListener("click", handleExpenseDelete);

  $("#addIdea").addEventListener("click", addIdea);
  $("#ideaList").addEventListener("input", updateIdea);
  $("#ideaList").addEventListener("click", handleIdeaAction);

  $(".prompt-chips").addEventListener("click", handleWritingPrompt);

  $("#addMedia").addEventListener("click", () => openMediaDialog());
  $("#mediaList").addEventListener("click", handleMediaAction);
  $("#mediaForm").addEventListener("submit", saveMediaFromForm);
  $("#closeMediaDialog").addEventListener("click", closeMediaDialog);
  $("#cancelMedia").addEventListener("click", closeMediaDialog);
  $("#mediaDialog").addEventListener("cancel", cleanupMediaForm);
  $("#mediaDialog").addEventListener("click", (event) => {
    if (event.target === $("#mediaDialog")) closeMediaDialog();
  });
  $$('input[name="mediaType"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      state.mediaType = radio.value;
      updateMediaTypeUI(radio.value);
    });
  });
  $("#mediaImage").addEventListener("change", previewSelectedImage);

  $("#openArchive").addEventListener("click", openArchive);
  $("#closeArchive").addEventListener("click", () => $("#archiveDialog").close());
  $("#archiveSearch").addEventListener("input", (event) => {
    state.archiveQuery = event.target.value.trim().toLowerCase();
    renderArchive();
  });
  $("#archiveFilters").addEventListener("click", handleArchiveFilter);
  $("#archiveList").addEventListener("click", handleArchiveOpen);

  $("#exportButton").addEventListener("click", exportBackup);
  $("#importButton").addEventListener("click", () => $("#importFile").click());
  $("#importFile").addEventListener("change", importBackup);
  $("#printButton").addEventListener("click", () => {
    flushSave();
    window.print();
  });

  $("#closeImagePreview").addEventListener("click", () => $("#imagePreviewDialog").close());
  $("#imagePreviewDialog").addEventListener("click", (event) => {
    if (event.target === $("#imagePreviewDialog")) $("#imagePreviewDialog").close();
  });

  window.addEventListener("beforeunload", flushSave);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushSave();
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && $("#imagePreviewDialog").open) {
      $("#imagePreviewDialog").close();
    }
  });
}

function renderAll() {
  renderDate();
  renderCalendar();
  renderStats();
  renderMood();
  renderDayFields();
  renderExpenses();
  renderIdeas();
  renderMedia();
}

function renderDate() {
  const date = parseDateKey(state.viewDate);
  const day = getDay(state.viewDate);
  const weekday = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"][
    date.getDay()
  ];
  const dayOfYear = getDayOfYear(date);
  const daysInYear = isLeapYear(date.getFullYear()) ? 366 : 365;

  $("#dayNumber").textContent = String(date.getDate()).padStart(2, "0");
  $("#monthYear").textContent = `${date.getFullYear()}年 ${date.getMonth() + 1}月`;
  $("#dateTitle").textContent = `${date.getMonth() + 1}月${date.getDate()}日，${weekday}`;
  $("#dayOrdinal").textContent = `今年的第 ${dayOfYear} 天 · ${daysInYear - dayOfYear} 天后新年`;
  $("#dateRelation").textContent = getDateRelation(state.viewDate);
  $("#dailyQuote").textContent = QUOTES[hashString(state.viewDate) % QUOTES.length];
  $("#footerDate").textContent = state.viewDate.replaceAll("-", ".");

  const checkinButton = $("#checkinButton");
  checkinButton.classList.toggle("checked", Boolean(day.checkedIn));
  checkinButton.setAttribute("aria-pressed", String(Boolean(day.checkedIn)));
  checkinButton.innerHTML = day.checkedIn
    ? `
      <span class="checkin-ring">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 12 4 4 8-9"/></svg>
      </span>
      <span>
        <strong>今天已盖下印章</strong>
        <small>这一页，已经写进了生活</small>
      </span>`
    : `
      <span class="checkin-ring">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 12 4 4 8-9"/></svg>
      </span>
      <span>
        <strong>今天，打个卡</strong>
        <small>留下这一天的痕迹</small>
      </span>`;
}

function renderCalendar() {
  const year = state.calendarMonth.getFullYear();
  const month = state.calendarMonth.getMonth();
  const firstDay = new Date(year, month, 1, 12);
  const mondayOffset = (firstDay.getDay() + 6) % 7;
  const gridStart = new Date(year, month, 1 - mondayOffset, 12);
  const today = toDateKey(new Date());
  const cells = [];

  $("#calendarTitle").textContent = `${year}年 ${month + 1}月`;

  for (let index = 0; index < 42; index += 1) {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    const key = toDateKey(date);
    const day = getDay(key);
    const classes = ["calendar-day"];

    if (date.getMonth() !== month) classes.push("other-month");
    if (key === today) classes.push("today");
    if (key === state.viewDate) classes.push("selected");
    if (dayHasContent(day)) classes.push("has-entry");
    if (day.checkedIn) classes.push("checked");

    cells.push(
      `<button class="${classes.join(" ")}" type="button" data-date="${key}" aria-label="${formatDateForAria(
        date,
      )}">${date.getDate()}</button>`,
    );
  }

  $("#calendarGrid").innerHTML = cells.join("");
}

function renderStats() {
  const today = new Date();
  const todayKey = toDateKey(today);
  const currentMonthPrefix = todayKey.slice(0, 7);
  let streak = 0;
  let cursor = parseDateKey(todayKey);

  while (getDay(toDateKey(cursor)).checkedIn) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }

  const monthDays = Object.entries(state.data.days).filter(
    ([key, day]) => key.startsWith(currentMonthPrefix) && dayHasContent(day),
  );
  const monthSpend = Object.entries(state.data.days)
    .filter(([key]) => key.startsWith(currentMonthPrefix))
    .flatMap(([, day]) => day.expenses)
    .reduce((total, expense) => total + parseAmount(expense.amount), 0);

  $("#streakCount").textContent = String(streak);
  $("#recordCount").textContent = String(monthDays.length);
  $("#monthSpend").textContent = formatMoney(monthSpend);

  const dayOfYear = getDayOfYear(today);
  const daysInYear = isLeapYear(today.getFullYear()) ? 366 : 365;
  $("#yearProgress").textContent = `今年已走过 ${Math.round((dayOfYear / daysInYear) * 100)}%`;
}

function renderMood() {
  const day = getDay(state.viewDate);
  $$("#moodOptions [data-mood]").forEach((button) => {
    const active = button.dataset.mood === day.mood;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function renderDayFields() {
  const day = getDay(state.viewDate);
  $$("[data-day-field]").forEach((field) => {
    const value = getByPath(day, field.dataset.dayField);
    field.value = typeof value === "string" ? value : "";
  });
}

function renderExpenses() {
  const day = getDay(state.viewDate);
  if (!day.expenses.length) {
    $("#expenseList").innerHTML =
      '<div class="expense-empty">今天还没有花费记录<br />点下面“记一笔”开始</div>';
    renderExpenseTotal();
    return;
  }

  $("#expenseList").innerHTML = day.expenses
    .map(
      (expense) => `
        <div class="expense-row" data-id="${escapeHTML(expense.id)}">
          <input
            type="text"
            data-expense-field="title"
            value="${escapeHTML(expense.title || "")}"
            placeholder="花在了哪里"
            aria-label="花费项目"
            maxlength="120"
          />
          <select data-expense-field="category" aria-label="花费分类">
            ${EXPENSE_CATEGORIES.map(
              (category) =>
                `<option value="${category}" ${
                  expense.category === category ? "selected" : ""
                }>${category}</option>`,
            ).join("")}
          </select>
          <input
            class="expense-amount"
            type="number"
            data-expense-field="amount"
            value="${escapeHTML(expense.amount ?? "")}"
            min="0"
            step="0.01"
            inputmode="decimal"
            placeholder="0.00"
            aria-label="花费金额"
          />
          <button class="row-delete" type="button" data-delete-expense aria-label="删除这笔花费">×</button>
        </div>`,
    )
    .join("");
  renderExpenseTotal();
}

function renderExpenseTotal() {
  const day = getDay(state.viewDate);
  const total = day.expenses.reduce((sum, item) => sum + parseAmount(item.amount), 0);
  $("#expenseTotal").textContent = formatMoney(total);
}

function renderIdeas() {
  const day = getDay(state.viewDate);
  if (!day.ideas.length) {
    $("#ideaList").innerHTML =
      '<div class="idea-empty">今天脑子里闪过了什么？<br />先记下来，大小以后再判断也可以。</div>';
    return;
  }

  $("#ideaList").innerHTML = day.ideas
    .map((idea) => {
      const isBig = idea.size === "big";
      return `
        <article class="idea-card ${isBig ? "big" : "small"}" data-id="${escapeHTML(idea.id)}">
          <div class="idea-card-header">
            <div class="idea-type-switch" role="group" aria-label="灵感类型">
              <button type="button" data-idea-size="small" class="${
                isBig ? "" : "active"
              }">小点子</button>
              <button type="button" data-idea-size="big" class="${
                isBig ? "active" : ""
              }">大点子</button>
            </div>
            <button class="row-delete" type="button" data-delete-idea aria-label="删除这个灵感">×</button>
          </div>
          <input
            class="idea-title"
            type="text"
            data-idea-field="title"
            value="${escapeHTML(idea.title || "")}"
            placeholder="${isBig ? "一个大方向，或一个想认真做的事" : "一句突然冒出来的小念头"}"
            maxlength="200"
            aria-label="灵感标题"
          />
          <textarea
            class="idea-body"
            data-idea-field="body"
            rows="3"
            maxlength="4000"
            placeholder="它从哪里来？想变成什么样？"
            aria-label="灵感内容"
          >${escapeHTML(idea.body || "")}</textarea>
          <div class="idea-footer">
            <span>${isBig ? "BIG IDEA" : "SMALL IDEA"} · ${formatTime(idea.createdAt)}</span>
            <button type="button" data-delete-idea>移除</button>
          </div>
        </article>`;
    })
    .join("");
}

async function renderMedia() {
  const requestedDate = state.viewDate;
  const day = getDay(requestedDate);
  if (!day.media.length) {
    $("#mediaList").innerHTML =
      '<div class="media-empty">这里还空着。<br />收下一段今天舍不得忘记的文字、影像或链接。</div>';
    return;
  }

  const rendered = await Promise.all(
    day.media.map(async (item) => {
      let imageSrc = null;
      if (item.type === "image" && item.imageId) {
        imageSrc = await getImageUrl(item.imageId);
      }
      return mediaItemHTML(item, imageSrc);
    }),
  );

  if (state.viewDate !== requestedDate) return;
  $("#mediaList").innerHTML = rendered.join("");
}

function mediaItemHTML(item, imageSrc) {
  if (item.type === "image") {
    return `
      <article class="media-card image" data-id="${escapeHTML(item.id)}">
        ${
          imageSrc
            ? `
              <button class="image-button" type="button" data-open-image aria-label="查看大图">
                <img src="${escapeHTML(imageSrc)}" alt="${escapeHTML(item.title || "收藏的图片")}" loading="lazy" />
              </button>
              <div class="image-overlay">
                <div>
                  <strong>${escapeHTML(item.title || "一张喜欢的图片")}</strong>
                  <small>${escapeHTML(item.note || "图片收藏")}</small>
                </div>
                <div class="image-overlay-actions">
                  <button type="button" data-edit-media>编辑</button>
                  <button type="button" data-delete-media>删除</button>
                </div>
              </div>`
            : `
              <div class="media-empty">图片文件未找到<br />它可能不在当前浏览器的图片库中</div>
              <div class="image-overlay">
                <div><strong>${escapeHTML(item.title || "图片收藏")}</strong></div>
                <div class="image-overlay-actions">
                  <button type="button" data-edit-media>编辑</button>
                  <button type="button" data-delete-media>删除</button>
                </div>
              </div>`
        }
      </article>`;
  }

  if (item.type === "video") {
    const url = safeExternalUrl(item.url);
    return `
      <article class="media-card video" data-id="${escapeHTML(item.id)}">
        <div>
          <div class="media-card-topline">
            <span>视频 / 链接</span>
            <span>${escapeHTML(getDomain(item.url))}</span>
          </div>
          <div class="video-mark">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7z"/></svg>
          </div>
          <h3>${escapeHTML(item.title || "一个想留下的链接")}</h3>
          <p>${escapeHTML(item.note || item.content || "打开它，回到第一次看见时的心情。")}</p>
        </div>
        <div class="media-actions">
          <button type="button" data-edit-media>编辑</button>
          <button type="button" data-delete-media>删除</button>
          ${
            url
              ? `<a class="open-link" href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer">打开 ↗</a>`
              : ""
          }
        </div>
      </article>`;
  }

  return `
    <article class="media-card text" data-id="${escapeHTML(item.id)}">
      <div class="media-card-topline">
        <span>好文字</span>
        <span>${formatTime(item.createdAt)}</span>
      </div>
      <h3>${escapeHTML(item.title || "今天读到的一段话")}</h3>
      <p>${escapeHTML(item.content || item.note || "一段舍不得划走的文字。")}</p>
      <div class="media-actions">
        <button type="button" data-edit-media>编辑</button>
        <button type="button" data-delete-media>删除</button>
        ${item.note && item.content ? `<span>有备注</span>` : ""}
      </div>
    </article>`;
}

function switchDate(key) {
  if (!isDateKey(key)) return;
  state.viewDate = key;
  state.calendarMonth = startOfMonth(parseDateKey(key));
  renderAll();
}

function goToToday() {
  switchDate(toDateKey(new Date()));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function changeDay(offset) {
  switchDate(toDateKey(addDays(parseDateKey(state.viewDate), offset)));
}

function moveCalendarMonth(offset) {
  state.calendarMonth = new Date(
    state.calendarMonth.getFullYear(),
    state.calendarMonth.getMonth() + offset,
    1,
  );
  renderCalendar();
}

function toggleCheckin() {
  const day = ensureDay(state.viewDate);
  day.checkedIn = !day.checkedIn;
  day.updatedAt = new Date().toISOString();
  saveNow();
  renderDate();
  renderCalendar();
  renderStats();
  showToast(day.checkedIn ? "今天盖好章了。今天的痕迹已经留下。" : "已取消这一天的打卡。");
}

function handleMoodClick(event) {
  const button = event.target.closest("[data-mood]");
  if (!button) return;
  const day = ensureDay(state.viewDate);
  day.mood = day.mood === button.dataset.mood ? "" : button.dataset.mood;
  day.updatedAt = new Date().toISOString();
  queueSave();
  renderMood();
  renderCalendar();
  renderStats();
}

function addExpense() {
  const day = ensureDay(state.viewDate);
  day.expenses.push({
    id: createId(),
    title: "",
    amount: "",
    category: "餐饮",
  });
  renderExpenses();
  const lastRow = $("#expenseList .expense-row:last-child input");
  if (lastRow) lastRow.focus();
}

function updateExpense(event) {
  const field = event.target.closest("[data-expense-field]");
  if (!field) return;
  const row = field.closest("[data-id]");
  const expense = ensureDay(state.viewDate).expenses.find(
    (item) => item.id === row?.dataset.id,
  );
  if (!expense) return;
  expense[field.dataset.expenseField] = field.value;
  ensureDay(state.viewDate).updatedAt = new Date().toISOString();
  renderExpenseTotal();
  renderStats();
  queueSave();
}

function handleExpenseDelete(event) {
  const button = event.target.closest("[data-delete-expense]");
  if (!button) return;
  const row = button.closest("[data-id]");
  const day = ensureDay(state.viewDate);
  const index = day.expenses.findIndex((item) => item.id === row?.dataset.id);
  if (index < 0) return;
  const item = day.expenses[index];
  if ((item.title || item.amount) && !window.confirm("删除这一笔花费记录？")) return;
  day.expenses.splice(index, 1);
  day.updatedAt = new Date().toISOString();
  saveNow();
  renderExpenses();
  renderCalendar();
  renderStats();
}

function addIdea() {
  const day = ensureDay(state.viewDate);
  day.ideas.push({
    id: createId(),
    size: "small",
    title: "",
    body: "",
    createdAt: new Date().toISOString(),
  });
  renderIdeas();
  const newCard = $("#ideaList .idea-card:last-child .idea-title");
  if (newCard) newCard.focus();
}

function updateIdea(event) {
  const field = event.target.closest("[data-idea-field]");
  if (!field) return;
  const card = field.closest("[data-id]");
  const idea = ensureDay(state.viewDate).ideas.find((item) => item.id === card?.dataset.id);
  if (!idea) return;
  idea[field.dataset.ideaField] = field.value;
  ensureDay(state.viewDate).updatedAt = new Date().toISOString();
  queueSave();
}

function handleIdeaAction(event) {
  const card = event.target.closest(".idea-card");
  if (!card) return;
  const day = ensureDay(state.viewDate);
  const idea = day.ideas.find((item) => item.id === card.dataset.id);
  if (!idea) return;

  const sizeButton = event.target.closest("[data-idea-size]");
  if (sizeButton) {
    idea.size = sizeButton.dataset.ideaSize;
    day.updatedAt = new Date().toISOString();
    saveNow();
    renderIdeas();
    renderCalendar();
    return;
  }

  const deleteButton = event.target.closest("[data-delete-idea]");
  if (!deleteButton) return;
  if ((idea.title || idea.body) && !window.confirm("删除这个灵感？")) return;
  day.ideas = day.ideas.filter((item) => item.id !== idea.id);
  day.updatedAt = new Date().toISOString();
  saveNow();
  renderIdeas();
  renderCalendar();
  renderStats();
}

function handleWritingPrompt(event) {
  const button = event.target.closest("[data-prompt]");
  if (!button) return;
  const textarea = $('[data-day-field="learnings"]');
  const prompt = button.dataset.prompt;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const before = textarea.value.slice(0, start);
  const after = textarea.value.slice(end);
  const prefix = before && !before.endsWith("\n") ? "\n" : "";
  const insertion = `${prefix}${prompt}：`;
  textarea.value = `${before}${insertion}${after}`;
  const nextPosition = before.length + insertion.length;
  textarea.focus();
  textarea.setSelectionRange(nextPosition, nextPosition);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

async function openMediaDialog(item = null) {
  cleanupMediaForm();
  $("#mediaForm").reset();
  $("#mediaId").value = item?.id || "";
  $("#mediaDialogTitle").textContent = item ? "编辑这条收藏" : "收藏一段喜欢";
  state.mediaType = item?.type || "text";
  const typeRadio = $(`input[name="mediaType"][value="${state.mediaType}"]`);
  if (typeRadio) typeRadio.checked = true;
  $("#mediaTitle").value = item?.title || "";
  $("#mediaContent").value = item?.content || "";
  $("#mediaNote").value = item?.note || "";
  $("#mediaUrl").value = item?.url || "";
  updateMediaTypeUI(state.mediaType);

  if (item?.type === "image" && item.imageId) {
    const imageUrl = await getImageUrl(item.imageId);
    if (imageUrl) {
      $("#mediaImagePreview").src = imageUrl;
      $("#mediaImagePreview").hidden = false;
      $("#uploadPrompt").hidden = true;
    }
  }

  $("#mediaDialog").showModal();
  window.setTimeout(() => $("#mediaTitle").focus(), 50);
}

function closeMediaDialog() {
  cleanupMediaForm();
  if ($("#mediaDialog").open) $("#mediaDialog").close();
}

function cleanupMediaForm() {
  if (state.pendingPreviewUrl) {
    URL.revokeObjectURL(state.pendingPreviewUrl);
    state.pendingPreviewUrl = null;
  }
  state.pendingImageFile = null;
  const preview = $("#mediaImagePreview");
  if (preview) {
    preview.removeAttribute("src");
    preview.hidden = true;
  }
  const prompt = $("#uploadPrompt");
  if (prompt) prompt.hidden = false;
  const imageInput = $("#mediaImage");
  if (imageInput) imageInput.value = "";
}

function updateMediaTypeUI(type) {
  state.mediaType = type;
  const isImage = type === "image";
  const isVideo = type === "video";
  $("#imageUploadField").hidden = !isImage;
  $("#urlField").hidden = !isVideo;
  $("#mediaContent").closest(".form-field").hidden = isImage;
  $("#mediaContentLabel").textContent = isVideo ? "简单介绍" : "文字内容";
  $("#mediaContent").placeholder = isVideo
    ? "为什么想留下这个视频？"
    : "把打动你的那段话留在这里...";
  $("#mediaUrl").required = isVideo;
}

function previewSelectedImage(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    showToast("请选择图片文件。");
    event.target.value = "";
    return;
  }
  if (state.pendingPreviewUrl) URL.revokeObjectURL(state.pendingPreviewUrl);
  state.pendingImageFile = file;
  state.pendingPreviewUrl = URL.createObjectURL(file);
  $("#mediaImagePreview").src = state.pendingPreviewUrl;
  $("#mediaImagePreview").hidden = false;
  $("#uploadPrompt").hidden = true;
}

async function saveMediaFromForm(event) {
  event.preventDefault();
  const submitButton = $("#mediaForm [type='submit']");
  const id = $("#mediaId").value;
  const oldItem = id ? findMediaById(id) : null;
  const type = $('input[name="mediaType"]:checked')?.value || "text";
  const title = $("#mediaTitle").value.trim();
  const content = $("#mediaContent").value.trim();
  const note = $("#mediaNote").value.trim();
  let url = $("#mediaUrl").value.trim();

  if (type === "video") {
    url = normalizeUrl(url);
    if (!url) {
      showToast("请填写一个有效的视频或网页链接。");
      $("#mediaUrl").focus();
      return;
    }
  }

  if (type === "text" && !title && !content && !note) {
    showToast("先写下一段文字或一句备注吧。");
    $("#mediaTitle").focus();
    return;
  }

  if (type === "image" && !state.pendingImageFile && !oldItem?.imageId) {
    showToast("请先选择一张图片。");
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = "正在保存…";

  try {
    let imageId = oldItem?.imageId || null;
    let imageToDelete = null;
    if (type === "image" && state.pendingImageFile) {
      const compressed = await compressImage(state.pendingImageFile);
      const newImageId = createId();
      await putImage(newImageId, compressed, {
        name: state.pendingImageFile.name,
        originalType: state.pendingImageFile.type,
      });
      if (imageId && imageId !== newImageId) imageToDelete = imageId;
      imageId = newImageId;
    }
    if (type !== "image" && imageId) {
      imageToDelete = imageId;
      imageId = null;
    }

    const day = ensureDay(state.viewDate);
    const item = {
      id: oldItem?.id || createId(),
      type,
      title,
      content,
      note,
      url: type === "video" ? url : "",
      imageId: type === "image" ? imageId : null,
      createdAt: oldItem?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    if (oldItem) {
      Object.assign(oldItem, item);
    } else {
      day.media.unshift(item);
    }
    day.updatedAt = new Date().toISOString();
    saveNow();

    if (imageToDelete) {
      await deleteImage(imageToDelete);
      revokeCachedImage(imageToDelete);
    }

    closeMediaDialog();
    await renderMedia();
    renderCalendar();
    renderStats();
    showToast(oldItem ? "收藏已更新。" : "已收进今天的手账。");
  } catch (error) {
    console.error(error);
    showToast("保存失败，可能是图片太大或浏览器存储空间不足。");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "保存到今天";
  }
}

async function handleMediaAction(event) {
  const card = event.target.closest(".media-card[data-id]");
  if (!card) return;
  const day = ensureDay(state.viewDate);
  const index = day.media.findIndex((item) => item.id === card.dataset.id);
  if (index < 0) return;
  const item = day.media[index];

  if (event.target.closest("[data-edit-media]")) {
    await openMediaDialog(item);
    return;
  }

  if (event.target.closest("[data-open-image]")) {
    const image = card.querySelector(".image-button img");
    if (image) {
      $("#previewImage").src = image.src;
      $("#imagePreviewDialog").showModal();
    }
    return;
  }

  if (!event.target.closest("[data-delete-media]")) return;
  if (!window.confirm("删除这条收藏？此操作不能撤销。")) return;
  day.media.splice(index, 1);
  day.updatedAt = new Date().toISOString();
  if (item.imageId) {
    await deleteImage(item.imageId);
    revokeCachedImage(item.imageId);
  }
  saveNow();
  await renderMedia();
  renderCalendar();
  renderStats();
  showToast("这条收藏已删除。");
}

function openArchive() {
  state.archiveFilter = "all";
  state.archiveQuery = "";
  $("#archiveSearch").value = "";
  $$("#archiveFilters button").forEach((button) => {
    button.classList.toggle("active", button.dataset.filter === "all");
  });
  renderArchive();
  $("#archiveDialog").showModal();
}

function handleArchiveFilter(event) {
  const button = event.target.closest("[data-filter]");
  if (!button) return;
  state.archiveFilter = button.dataset.filter;
  $$("#archiveFilters button").forEach((item) => {
    item.classList.toggle("active", item === button);
  });
  renderArchive();
}

function collectArchiveItems() {
  const items = [];
  Object.entries(state.data.days).forEach(([dateKey, day]) => {
    day.ideas.forEach((idea) => {
      items.push({
        kind: "idea",
        dateKey,
        id: idea.id,
        title: idea.title || "未命名的灵感",
        text: idea.body || "还没有补充内容。",
        typeLabel: idea.size === "big" ? "大点子" : "小点子",
        filter: idea.size,
        createdAt: idea.createdAt || `${dateKey}T12:00:00`,
      });
    });
    day.media.forEach((media) => {
      const typeLabels = { text: "好文字", image: "图片", video: "视频 / 链接" };
      items.push({
        kind: "media",
        dateKey,
        id: media.id,
        title: media.title || typeLabels[media.type] || "收藏",
        text: media.content || media.note || media.url || "一条没有备注的收藏。",
        typeLabel: typeLabels[media.type] || "收藏",
        filter: "media",
        createdAt: media.createdAt || `${dateKey}T12:00:00`,
      });
    });
  });
  return items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function renderArchive() {
  const query = state.archiveQuery;
  const filter = state.archiveFilter;
  const items = collectArchiveItems().filter((item) => {
    const matchesFilter = filter === "all" || item.filter === filter;
    const haystack = `${item.title} ${item.text} ${item.typeLabel} ${item.dateKey}`.toLowerCase();
    return matchesFilter && (!query || haystack.includes(query));
  });

  if (!items.length) {
    $("#archiveList").innerHTML =
      '<div class="archive-empty">这里还没有符合条件的内容。<br />回到今天，记下第一个灵感吧。</div>';
    return;
  }

  $("#archiveList").innerHTML = items
    .map(
      (item) => `
        <button
          class="archive-item"
          type="button"
          data-date="${item.dateKey}"
          data-id="${escapeHTML(item.id)}"
          data-kind="${item.kind}"
        >
          <span class="archive-meta">
            <span class="archive-type">${escapeHTML(item.typeLabel)}</span>
            <span>${formatArchiveDate(item.dateKey)}</span>
          </span>
          <h3>${escapeHTML(item.title)}</h3>
          <p>${escapeHTML(item.text)}</p>
        </button>`,
    )
    .join("");
}

function handleArchiveOpen(event) {
  const item = event.target.closest(".archive-item");
  if (!item) return;
  switchDate(item.dataset.date);
  $("#archiveDialog").close();
  window.setTimeout(() => {
    const target = $$(`[data-id]`).find(
      (element) =>
        element.dataset.id === item.dataset.id && !element.closest("#archiveDialog"),
    );
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.classList.add("focus-pulse");
      window.setTimeout(() => target.classList.remove("focus-pulse"), 1400);
    }
  }, 100);
}

async function exportBackup() {
  flushSave();
  const button = $("#exportButton");
  const previousText = button.innerHTML;
  button.disabled = true;
  button.textContent = "正在整理…";

  try {
    const images = await getAllImages();
    const serializedImages = [];
    for (const image of images) {
      serializedImages.push({
        id: image.id,
        name: image.name || "",
        originalType: image.originalType || image.blob?.type || "",
        dataUrl: await blobToDataURL(image.blob),
      });
    }

    const backup = {
      app: "one-page-journal",
      version: 1,
      exportedAt: new Date().toISOString(),
      data: state.data,
      images: serializedImages,
    };
    const blob = new Blob([JSON.stringify(backup)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `一页手账备份-${toDateKey(new Date())}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(`备份已导出，共包含 ${serializedImages.length} 张图片。`);
  } catch (error) {
    console.error(error);
    showToast("备份导出失败，请稍后再试。");
  } finally {
    button.disabled = false;
    button.innerHTML = previousText;
  }
}

async function importBackup(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;

  try {
    const backup = JSON.parse(await file.text());
    if (backup?.app !== "one-page-journal" || !backup?.data?.days) {
      throw new Error("invalid-backup");
    }
    if (
      !window.confirm(
        "导入备份会替换当前浏览器里的手账数据，包括所有图片。建议先导出当前数据。确定继续吗？",
      )
    ) {
      return;
    }

    await clearImages();
    state.imageUrlCache.forEach((url) => URL.revokeObjectURL(url));
    state.imageUrlCache.clear();

    for (const image of backup.images || []) {
      if (!image?.id || !image?.dataUrl) continue;
      const blob = await dataURLToBlob(image.dataUrl);
      await putImage(image.id, blob, {
        name: image.name || "",
        originalType: image.originalType || "",
      });
    }

    state.data = normalizeData(backup.data);
    state.viewDate = toDateKey(new Date());
    state.calendarMonth = startOfMonth(new Date());
    saveNow();
    renderAll();
    showToast("备份已导入，手账已经恢复到备份时的状态。");
  } catch (error) {
    console.error(error);
    showToast("无法读取这个备份文件，请确认它是本手账导出的 JSON 文件。");
  }
}

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { data: createEmptyData(), hadError: false };
    return { data: normalizeData(JSON.parse(raw)), hadError: false };
  } catch (error) {
    console.error(error);
    return { data: createEmptyData(), hadError: true };
  }
}

function createEmptyData() {
  return {
    app: "one-page-journal",
    version: 1,
    days: {},
  };
}

function createEmptyDay() {
  return {
    checkedIn: false,
    mood: "",
    meals: {
      breakfast: "",
      lunch: "",
      dinner: "",
      snack: "",
    },
    learnings: "",
    gratitude: "",
    expenses: [],
    ideas: [],
    media: [],
    updatedAt: null,
  };
}

function normalizeData(raw) {
  const result = createEmptyData();
  if (!raw || typeof raw !== "object") return result;
  const days = raw.days && typeof raw.days === "object" ? raw.days : {};

  Object.entries(days).forEach(([key, value]) => {
    if (!isDateKey(key) || !value || typeof value !== "object") return;
    const defaults = createEmptyDay();
    result.days[key] = {
      ...defaults,
      ...value,
      checkedIn: Boolean(value.checkedIn),
      mood: MOODS.includes(value.mood) ? value.mood : "",
      meals: { ...defaults.meals, ...(value.meals || {}) },
      learnings: typeof value.learnings === "string" ? value.learnings : "",
      gratitude: typeof value.gratitude === "string" ? value.gratitude : "",
      expenses: Array.isArray(value.expenses)
        ? value.expenses.map((item) => ({
            id: item.id || createId(),
            title: String(item.title || ""),
            amount: String(item.amount || ""),
            category: EXPENSE_CATEGORIES.includes(item.category)
              ? item.category
              : "其他",
          }))
        : [],
      ideas: Array.isArray(value.ideas)
        ? value.ideas.map((item) => ({
            id: item.id || createId(),
            size: item.size === "big" ? "big" : "small",
            title: String(item.title || ""),
            body: String(item.body || ""),
            createdAt: item.createdAt || `${key}T12:00:00`,
          }))
        : [],
      media: Array.isArray(value.media)
        ? value.media.map((item) => ({
            id: item.id || createId(),
            type: ["text", "image", "video"].includes(item.type) ? item.type : "text",
            title: String(item.title || ""),
            content: String(item.content || ""),
            note: String(item.note || ""),
            url: String(item.url || ""),
            imageId: item.imageId || null,
            createdAt: item.createdAt || `${key}T12:00:00`,
            updatedAt: item.updatedAt || null,
          }))
        : [],
    };
  });

  return result;
}

function getDay(key) {
  const day = state.data.days[key];
  return day ? normalizeDayInPlace(day, key) : createEmptyDay();
}

function normalizeDayInPlace(day, key) {
  if (!day.meals) day.meals = createEmptyDay().meals;
  if (!Array.isArray(day.expenses)) day.expenses = [];
  if (!Array.isArray(day.ideas)) day.ideas = [];
  if (!Array.isArray(day.media)) day.media = [];
  if (!day.updatedAt) day.updatedAt = `${key}T12:00:00`;
  return day;
}

function ensureDay(key) {
  if (!state.data.days[key]) {
    state.data.days[key] = createEmptyDay();
  }
  return normalizeDayInPlace(state.data.days[key], key);
}

function dayHasContent(day) {
  return Boolean(
    day.checkedIn ||
      day.mood ||
      Object.values(day.meals || {}).some((value) => String(value).trim()) ||
      String(day.learnings || "").trim() ||
      String(day.gratitude || "").trim() ||
      day.expenses?.some(
        (item) => String(item.title || "").trim() || String(item.amount || "").trim(),
      ) ||
      day.ideas?.some(
        (item) => String(item.title || "").trim() || String(item.body || "").trim(),
      ) ||
      day.media?.length,
  );
}

function queueSave() {
  setSaveStatus("正在保存…", true);
  window.clearTimeout(state.saveTimer);
  state.saveTimer = window.setTimeout(saveNow, 350);
}

function saveNow() {
  window.clearTimeout(state.saveTimer);
  state.saveTimer = null;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
    setSaveStatus("所有更改已保存", false);
  } catch (error) {
    console.error(error);
    setSaveStatus("保存失败，请立即导出备份", true);
    showToast("浏览器存储空间可能已满，请先导出备份。");
  }
}

function flushSave() {
  if (state.saveTimer) saveNow();
}

function setSaveStatus(text, saving) {
  const status = $("#saveStatus");
  if (!status) return;
  status.textContent = text;
  status.classList.toggle("saving", saving);
}

function findMediaById(id) {
  for (const day of Object.values(state.data.days)) {
    const item = day.media.find((media) => media.id === id);
    if (item) return item;
  }
  return null;
}

function openImageDatabase() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(DB_STORE)) {
        database.createObjectStore(DB_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return databasePromise;
}

async function putImage(id, blob, metadata = {}) {
  const database = await openImageDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(DB_STORE, "readwrite");
    transaction.objectStore(DB_STORE).put({
      id,
      blob,
      ...metadata,
      updatedAt: new Date().toISOString(),
    });
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}

async function getImage(id) {
  const database = await openImageDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(DB_STORE, "readonly").objectStore(DB_STORE).get(id);
    request.onsuccess = () => resolve(request.result?.blob || null);
    request.onerror = () => reject(request.error);
  });
}

async function getImageUrl(id) {
  if (state.imageUrlCache.has(id)) return state.imageUrlCache.get(id);
  try {
    const blob = await getImage(id);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    state.imageUrlCache.set(id, url);
    return url;
  } catch {
    return null;
  }
}

async function deleteImage(id) {
  try {
    const database = await openImageDatabase();
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(DB_STORE, "readwrite");
      transaction.objectStore(DB_STORE).delete(id);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
  } catch (error) {
    console.warn("Could not delete image", error);
  }
}

async function getAllImages() {
  const database = await openImageDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(DB_STORE, "readonly").objectStore(DB_STORE).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

async function clearImages() {
  const database = await openImageDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(DB_STORE, "readwrite");
    transaction.objectStore(DB_STORE).clear();
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}

function revokeCachedImage(id) {
  const url = state.imageUrlCache.get(id);
  if (url) URL.revokeObjectURL(url);
  state.imageUrlCache.delete(id);
}

async function compressImage(file) {
  if (file.type === "image/gif" || file.type === "image/svg+xml") {
    return file;
  }

  let source;
  try {
    source = await createImageBitmap(file);
  } catch {
    source = await loadImageElement(file);
  }

  const maxDimension = 1800;
  const ratio = Math.min(1, maxDimension / Math.max(source.width, source.height));
  const width = Math.max(1, Math.round(source.width * ratio));
  const height = Math.max(1, Math.round(source.height * ratio));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.drawImage(source, 0, 0, width, height);
  if (source.close) source.close();

  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, "image/webp", 0.84),
  );
  if (!blob) return file;
  return blob.size < file.size ? blob : file;
}

function loadImageElement(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Image decode failed"));
    };
    image.src = url;
  });
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function dataURLToBlob(dataUrl) {
  const response = await fetch(dataUrl);
  return response.blob();
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(state.toastTimer);
  state.toastTimer = window.setTimeout(() => toast.classList.remove("show"), 3200);
}

function setByPath(object, path, value) {
  const keys = path.split(".");
  let target = object;
  keys.slice(0, -1).forEach((key) => {
    if (!target[key] || typeof target[key] !== "object") target[key] = {};
    target = target[key];
  });
  target[keys.at(-1)] = value;
}

function getByPath(object, path) {
  return path.split(".").reduce((value, key) => value?.[key], object);
}

function parseAmount(value) {
  const amount = Number.parseFloat(String(value ?? "").replace(",", "."));
  return Number.isFinite(amount) && amount >= 0 ? amount : 0;
}

function formatMoney(value) {
  return `¥${new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value)}`;
}

function formatTime(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function formatArchiveDate(key) {
  const date = parseDateKey(key);
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

function formatDateForAria(date) {
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function getDateRelation(key) {
  const difference = daysBetween(parseDateKey(key), parseDateKey(toDateKey(new Date())));
  if (difference === 0) return "今天";
  if (difference === -1) return "昨天";
  if (difference === 1) return "明天";
  return difference < 0 ? `${Math.abs(difference)}天前` : `${difference}天后`;
}

function getDayOfYear(date) {
  const current = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const start = Date.UTC(date.getFullYear(), 0, 1);
  return Math.floor((current - start) / 86_400_000) + 1;
}

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateKey(key) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1, 12);
}

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function daysBetween(later, earlier) {
  const laterUtc = Date.UTC(later.getFullYear(), later.getMonth(), later.getDate());
  const earlierUtc = Date.UTC(earlier.getFullYear(), earlier.getMonth(), earlier.getDate());
  return Math.round((laterUtc - earlierUtc) / 86_400_000);
}

function isDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return false;
  const date = parseDateKey(value);
  return toDateKey(date) === value;
}

function createId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function hashString(value) {
  return String(value)
    .split("")
    .reduce((hash, character) => (hash * 31 + character.charCodeAt(0)) >>> 0, 7);
}

function normalizeUrl(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function safeExternalUrl(value) {
  return normalizeUrl(value);
}

function getDomain(value) {
  const url = safeExternalUrl(value);
  if (!url) return "外部链接";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "外部链接";
  }
}

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
