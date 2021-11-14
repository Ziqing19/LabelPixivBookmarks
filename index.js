// ==UserScript==
// @name         Pixiv收藏夹自动标签
// @name:en      Label Pixiv Bookmarks
// @namespace    http://tampermonkey.net/
// @version      4.0
// @description  自动为Pixiv收藏夹内图片打上已有的标签
// @description:en    Automatically add existing labels for images in the bookmarks
// @author       philimao
// @match        https://www.pixiv.net/*users/*
// @icon         https://www.google.com/s2/favicons?domain=pixiv.net
// @resource     bootstrapCSS https://cdn.jsdelivr.net/npm/bootstrap@5.0.1/dist/css/bootstrap.min.css
// @resource     bootstrapJS https://cdn.jsdelivr.net/npm/bootstrap@5.0.2/dist/js/bootstrap.bundle.min.js
// @grant        unsafeWindow
// @grant        GM_getResourceURL
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @license      MIT

// ==/UserScript==

let uid, token, userTags, synonymDict;

Array.prototype.toUpperCase = function () {
  return this.map((i) => i.toUpperCase());
};

function isEqualObject(obj1, obj2) {
  return (
    typeof obj1 === "object" &&
    typeof obj2 === "object" &&
    Object.keys(obj1).every((key, i) => key === Object.keys(obj2)[i]) &&
    Object.values(obj1).every((value, i) => value === Object.values(obj2)[i])
  );
}

function delay(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

function sortByParody(array) {
  const sortFunc = (a, b) => {
    let reg = /^[a-zA-Z0-9]/;
    if (reg.test(a) && !reg.test(b)) return -1;
    else if (!reg.test(a) && reg.test(b)) return 1;
    else return a.localeCompare(b, "zh");
  };
  const withParody = array.filter((key) => key.includes("("));
  const withoutParody = array.filter((key) => !key.includes("("));
  withoutParody.sort(sortFunc);
  withParody.sort(sortFunc);
  withParody.sort((a, b) => sortFunc(a.split("(")[1], b.split("(")[1]));
  return withoutParody.concat(withParody);
}

function loadResources() {
  function cssElement(url) {
    const link = document.createElement("link");
    link.href = url;
    link.rel = "stylesheet";
    link.type = "text/css";
    return link;
  }
  function jsElement(url) {
    const script = document.createElement("script");
    script.src = url;
    script.integrity =
      "sha384-MrcW6ZMFYlzcLA8Nl+NtUVF0sA7MsXsP1UyJoMp4YLEuNSfAP+JcXn/tWtIaxVXM";
    script.crossOrigin = "anonymous";
    return script;
  }
  document.head.appendChild(cssElement(GM_getResourceURL("bootstrapCSS")));
  document.head.appendChild(jsElement(GM_getResourceURL("bootstrapJS")));
}

async function fetchBookmarks(uid, tagToQuery, offset, publicationType) {
  const bookmarksRaw = await fetch(
    "https://www.pixiv.net/ajax/user/" +
      uid +
      "/illusts/bookmarks?tag=" +
      tagToQuery +
      "&offset=" +
      offset +
      "&limit=100&rest=" +
      publicationType
  );
  await delay(500);
  const bookmarksRes = await bookmarksRaw.json();
  if (!bookmarksRaw.ok || bookmarksRes.error === true) {
    return alert(
      `获取用户收藏夹列表失败
Fail to fetch user bookmarks\n` + decodeURI(bookmarksRes.message)
    );
  } else return bookmarksRes.body;
}

async function updateBookmarkTags(bookmarkIds, tags, removeTags) {
  if (tags && tags.length) {
    await fetch("https://www.pixiv.net/ajax/illusts/bookmarks/add_tags", {
      headers: {
        accept: "application/json",
        "content-type": "application/json; charset=utf-8",
        "x-csrf-token": token,
      },
      body: JSON.stringify({ tags, bookmarkIds }),
      method: "POST",
    });
    await delay(500);
  }

  if (removeTags && removeTags.length) {
    await fetch("https://www.pixiv.net/ajax/illusts/bookmarks/remove_tags", {
      headers: {
        accept: "application/json",
        "content-type": "application/json; charset=utf-8",
        "x-csrf-token": token,
      },
      body: JSON.stringify({ removeTags, bookmarkIds }),
      method: "POST",
    });
    await delay(500);
  }
}

async function removeBookmarkTags(evt) {
  evt.preventDefault();
  if (
    !window.confirm(
      `确定要删除所选作品的标签吗？（不会解除收藏）
The tags of work(s) you've selected will be removed (become uncategorized). Is this okay?`
    )
  )
    return;
  const pids = [
    ...document.querySelectorAll(".cnmYO[aria-disabled='true']"),
  ].map((el) => el.querySelector("span").getAttribute("data-gtm-value"));

  for (let pid of pids) {
    console.log("Removing", pid);
    await fetch(`https://www.pixiv.net/bookmark_add.php?id=${pid}`, {
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        Referer: `https://www.pixiv.net/bookmark_add.php?type=illust&illust_id=${pid}`,
        "Referrer-Policy": "strict-origin-when-cross-origin",
      },
      body: `mode=add&tt=${token}&id=${pid}&type=illust&comment=&tag=&restrict=0`,
      method: "POST",
    });
    await delay(500);
    // todo use remove_tag api to avoid 302
  }
  window.alert(`标签删除完成！
Tags Removed!`);
}

const DEBUG = false;
async function handleLabel(evt) {
  evt.preventDefault();

  const addFirst = document.querySelector("#label_add_first").value;
  const tagToQuery = document.querySelector("#label_tag_query").value;
  const publicationType = document.querySelector(
    "#label_publication_type"
  ).value;
  const retainTag = document.querySelector("#label_retain_tag").value;

  console.log("Label Configuration:");
  console.log(
    `addFirst: ${addFirst === "true"}; tagToQuery: ${tagToQuery}; retainTag: ${
      retainTag === "true"
    }; publicationType: ${publicationType}`
  );

  window.runFlag = true;
  const promptBottom = document.querySelector("#label_prompt");
  promptBottom.innerText =
    "处理中，请勿关闭窗口\nProcessing. Please do not close the window.";
  const objDiv = document.querySelector("#label_form");
  objDiv.scrollTop = objDiv.scrollHeight;

  // fetch bookmarks
  let total, // total bookmarks of specific tag
    index = 0, // counter of do-while loop
    offset = 0; // as uncategorized ones will decrease, offset means num of images "successfully" updated
  // update progress bar
  const progressBar = document.querySelector("#progress_bar");
  const intervalId = setInterval(() => {
    if (total) {
      progressBar.innerText = index + "/" + total;
      const ratio = ((index / total) * 100).toFixed(2);
      progressBar.style.width = ratio + "%";
      if (!window.runFlag || index === total) {
        console.log("Progress bar stops updating");
        clearInterval(intervalId);
      }
    }
  }, 1000);
  do {
    const realOffset = tagToQuery === "未分類" ? offset : index;
    const bookmarks = await fetchBookmarks(
      uid,
      tagToQuery,
      realOffset,
      publicationType
    );
    if (DEBUG) console.log("Bookmarks", bookmarks);
    if (!total) total = bookmarks.total;
    for (let work of bookmarks["works"]) {
      const url = "https://www.pixiv.net/en/artworks/" + work.id;
      if (DEBUG) console.log(index, work.title, work.id, url);
      index++;
      // ---- means unavailable, hidden or deleted by author
      if (work.title === "-----") {
        offset++;
        continue;
      }
      const workTags = work["tags"];
      let intersection = userTags.filter((userTag) => {
        // if work tags includes this user tag
        if (
          workTags.toUpperCase().includes(userTag.toUpperCase()) ||
          workTags.toUpperCase().includes(userTag.toUpperCase().split("(")[0])
        )
          return true;
        // if work tags match an user alias (exact match)
        return (
          synonymDict[userTag] &&
          synonymDict[userTag].find(
            (alias) =>
              workTags.toUpperCase().includes(alias.toUpperCase()) ||
              workTags.toUpperCase().includes(alias.toUpperCase().split("(")[0])
          )
        );
      });
      // if workTags match some alias, add it to the intersection (exact match, with or without parody name)
      intersection = intersection.concat(
        workTags
          .map((workTag) => {
            for (let aliasName of Object.keys(synonymDict)) {
              if (
                synonymDict[aliasName].toUpperCase().includes(workTag) ||
                synonymDict[aliasName]
                  .toUpperCase()
                  .includes(workTag.split("(")[0])
              )
                return aliasName;
            }
          })
          .filter((i) => i)
      );
      // remove duplicate
      intersection = Array.from(new Set(intersection));

      const bookmarkId = work["bookmarkData"]["id"];
      const prevTags = bookmarks["bookmarkTags"][bookmarkId] || [];

      let removeTags = [];
      if (retainTag === "false")
        removeTags = prevTags.filter((tag) => !intersection.includes(tag));
      const addTags = intersection.filter((tag) => !prevTags.includes(tag));

      if (!intersection.length && !prevTags.length) {
        if (addFirst === "true") {
          intersection.push(workTags[0]);
          userTags.push(workTags[0]);
        }
      }
      // for uncategorized
      if (!intersection.length) {
        offset++;
      }
      if (addTags.length || removeTags.length) {
        if (!DEBUG) console.log(index, work.title, work.id, url);
        console.log("\tprevTags:", prevTags);
        console.log("\tintersection:", intersection);
        console.log("\taddTags:", addTags, "removeTags:", removeTags);
      }

      await updateBookmarkTags([bookmarkId], addTags, removeTags);

      if (!window.runFlag) {
        promptBottom.innerText =
          "检测到停止信号，程序已停止运行\nStop signal detected. Program exits.";
        index = total;
        break;
      }
    }
  } while (index < total);
  if (total === 0) {
    promptBottom.innerText = `指定分类下暂无符合要求的作品，请关闭窗口
  Works needed to be labeled not found. Please close the window.
  `;
  } else {
    promptBottom.innerText = `自动添加标签已完成，请关闭窗口并刷新网页
  Auto labeling finished successfully. Please close the window and refresh.
  `;
  }
}

let prevSearch, searchBatch, searchResults, searchOffset, totalBookmarks;
async function handleSearch(evt) {
  evt.preventDefault();

  const searchString = document
    .querySelector("#search_value")
    .value.replace(/！/g, "!");
  const matchPattern = document.querySelector("#search_exact_match").value;
  const tagToQuery = document.querySelector("#search_select_tag").value;
  const publicationType = document.querySelector("#search_publication").value;
  const newSearch = { searchString, matchPattern, tagToQuery, publicationType };

  // initialize new search
  const resultsDiv = document.querySelector("#search_results");
  const noResult = document.querySelector("#no_result");
  if (noResult) resultsDiv.removeChild(noResult);
  if (!prevSearch || !isEqualObject(prevSearch, newSearch)) {
    prevSearch = newSearch;
    searchResults = [];
    searchOffset = 0;
    totalBookmarks = 0;
    searchBatch = 200;
    document.querySelector("#search_prompt").innerText = "";
    while (resultsDiv.firstChild) {
      resultsDiv.removeChild(resultsDiv.firstChild);
    }
  } else {
    searchBatch += 200;
  }

  if (searchOffset && searchOffset === totalBookmarks)
    return alert(`
    已经完成所选标签下所有收藏的搜索！
    All Bookmarks Of Selected Tag Have Been Searched!
    `);

  document.querySelector("#spinner").style.display = "block";

  const collapseIns = bootstrap.Collapse.getInstance(
    document.querySelector("#advanced_search")
  );
  if (collapseIns) collapseIns.hide();

  let includeArray = searchString
    .split(" ")
    .filter((el) => el.length && !el.includes("!"));
  let excludeArray = searchString
    .split(" ")
    .filter((el) => el.length && el.includes("!"))
    .map((el) => el.slice(1));

  console.log("Search Configuration:");
  console.log(
    `matchPattern: ${matchPattern}; tagToQuery: ${tagToQuery}; publicationType: ${publicationType}`
  );
  console.log("includeArray:", includeArray, "excludeArray", excludeArray);

  let index = 0; // index for current search batch
  do {
    const bookmarks = await fetchBookmarks(
      uid,
      tagToQuery,
      searchOffset,
      publicationType
    );
    document.querySelector("#search_prompt").innerText = `
    当前搜索进度 / Searched：${searchOffset} / ${totalBookmarks}
  `;
    if (DEBUG) console.log(bookmarks);
    if (!totalBookmarks) {
      totalBookmarks = bookmarks.total;
    }
    for (let work of bookmarks["works"]) {
      if (DEBUG) {
        console.log(searchOffset, work.title, work.id);
        console.log(work["tags"]);
      }
      index++;
      searchOffset++;

      if (work.title === "-----") continue;
      const workTags = work["tags"];

      const ifInclude = (keyword) => {
        // especially, R-18 tag is labelled in work
        if (["R-18", "R18", "r18"].includes(keyword)) return work["xRestrict"];

        // keywords from user input, alias from dict
        // keyword: 新世纪福音战士
        // alias: EVA eva
        const el = Object.keys(synonymDict)
          .map((i) => [i.split("(")[0], i])
          .find(
            (el) =>
              el[0].toUpperCase() === keyword.toUpperCase() ||
              (matchPattern === "fuzzy" &&
                el[0].toUpperCase().includes(keyword.toUpperCase()))
          );
        const keywordArray = el
          ? synonymDict[el[1]].concat(keyword)
          : [keyword];
        if (
          keywordArray.some((kw) =>
            workTags.toUpperCase().includes(kw.toUpperCase())
          ) ||
          keywordArray.some(
            (
              kw // remove work tag braces
            ) =>
              workTags
                .map((tag) => tag.split("(")[0])
                .toUpperCase()
                .includes(kw.toUpperCase())
          )
        )
          return true;
        if (matchPattern === "exact") return false;
        return keywordArray.some(
          (kw) =>
            workTags.some((tag) =>
              tag.toUpperCase().includes(kw.toUpperCase())
            ) ||
            keywordArray.some(
              (
                kw // remove work tag braces
              ) =>
                workTags
                  .toUpperCase()
                  .map((tag) => tag.split("(")[0])
                  .some((tag) => tag.includes(kw.toUpperCase()))
            )
        );
      };

      if (includeArray.every(ifInclude) && !excludeArray.some(ifInclude)) {
        searchResults.push(work);
        const container = document.createElement("div");
        container.className = "col-4 col-lg-3 col-xl-2 p-1";
        container.innerHTML = `
        <div class="mb-1">
         <a href=${"/artworks/" + work.id}>
          <img src=${work.url} alt="square" class="rounded-3 img-fluid" />
          </a>
        </div>
       <div class="mb-1">
         <a href=${"/artworks/" + work.id}
          style="font-weight: bold; color: rgba(0, 0, 0, 0.88);">
          ${work.title}
          </a>
       </div>
       <div class="mb-4">
        <a href=${"/users" + work.userId}
          style="rgba(0, 0, 0, 0.64)">
          <img
            src=${work.profileImageUrl} alt="profile" class="rounded-circle"
            style="width: 24px; height: 24px; margin-right: 4px"
          />
          ${work.userName}
        </a>
       </div>
      `;
        resultsDiv.appendChild(container);
      }
    }
  } while (searchOffset < totalBookmarks && index < searchBatch);
  if (totalBookmarks === 0)
    document.querySelector("#search_prompt").innerText = "无结果 / No Result";
  else
    document.querySelector("#search_prompt").innerText = `
    当前搜索进度 / Searched：${searchOffset} / ${totalBookmarks}
  `;
  if (searchOffset < totalBookmarks)
    document.querySelector("#search_more").style.display = "block";
  else document.querySelector("#search_more").style.display = "none";
  if (!searchResults.length) {
    resultsDiv.innerHTML = `
      <div class="text-center text-black-50 fw-bold py-4" style="white-space: pre-wrap; font-size: 2rem" id="no_result">
暂无结果
No Result
      </div>
    `;
  }
  document.querySelector("#spinner").style.display = "none";
  console.log(searchResults);
}

function createModalElements() {
  // label
  const popupLabel = document.createElement("div");
  popupLabel.className = "modal fade";
  popupLabel.id = "label_modal";
  popupLabel.tabIndex = -1;
  popupLabel.innerHTML = `
    <div class="modal-dialog modal-lg bg-white" style="pointer-events: initial">
      <div class="modal-header">
        <h5 class="modal-title">自动添加标签 / Label Bookmarks</h5>
        <button class="btn btn-close" data-bs-dismiss="modal" />
      </div>
      <form class="modal-body p-4" id="label_form">
        <div class="text-center mb-4">
          <div>如果对以下配置有疑惑，请参考
            <a href="https://greasyfork.org/zh-CN/scripts/423823-pixiv%E6%94%B6%E8%97%8F%E5%A4%B9%E8%87%AA%E5%8A%A8%E6%A0%87%E7%AD%BE?locale_override=1" style="text-decoration: underline"
              target="_blank" rel="noreferrer">文档</a>
          </div>
          <div>Please refer to the
            <a href="https://greasyfork.org/en/scripts/423823-pixiv%E6%94%B6%E8%97%8F%E5%A4%B9%E8%87%AA%E5%8A%A8%E6%A0%87%E7%AD%BE" style="text-decoration: underline"
              target="_blank" rel="noreferrer">document</a> if confused.
          </div>
        </div>
        <div class="mb-4">
          <div role="button" class="mb-3" data-bs-toggle="collapse" data-bs-target="#synonym_content">
            &#9658; 同义词词典 / Synonym Dict
          </div>
          <div class="collapse show px-3" id="synonym_content">
            <div class="mb-4">
              <div role="button" class="mb-3 fw-light" data-bs-toggle="collapse"
                data-bs-target="#load_synonym_dict">&#9658; 加载词典 / Load Dict</div>
              <div class="mb-3 collapse" id="load_synonym_dict">
                <input class="form-control border mb-3" type="file" accept="application/json" id="synonym_dict_input"/>
              </div>
            </div>
            <div class="mb-4">
              <div role="button" class="mb-3 fw-light" data-bs-toggle="collapse"
                data-bs-target="#edit_synonym_dict">&#9658; 编辑词典 / Edit Dict</div>
              <div class="mb-3 collapse" id="edit_synonym_dict">
                <label class="form-label fw-light" for="target_tag">目标标签（用户标签） / Target Tag (User Tag)</label>
                <input class="form-control mb-3" type="text" id="target_tag" placeholder="eg: 新世紀エヴァンゲリオン">
                <label class="form-label fw-light" for="tag_alias">同义词（作品标签，空格分割） / Alias (From Artwork, Space Delimited)</label>
                <input class="form-control mb-3" type="text" id="tag_alias" placeholder="eg: エヴァンゲリオン evangelion Evangelion eva EVA">
                <div class="d-flex mb-3" id="synonym_buttons">
                  <button role="button" class="btn btn-outline-primary me-auto" title="保存至本地\nSave to Local Disk">导出词典 / Export Dict</button>
                  <button role="button" class="btn btn-outline-primary me-3" title="加载已有标签的同义词\nLoad Alias of Existing User Tag">加载标签 / Load Tag</button>
                  <button role="button" class="btn btn-outline-primary" title="保存结果至词典，同义词为空时将删除该项\nUpdate dict. User tag will be removed if alias is empty">更新标签 / Update Tag</button>
                </div>
              </div>
            </div>
            <div class="mb-4">
              <div role="button" class="mb-3 fw-light" data-bs-toggle="collapse"
                data-bs-target="#preview_synonym_dict">&#9658; 预览词典 / Preview Dict</div>
              <div class="mb-3 collapse show" id="preview_synonym_dict">
                <div class="mb-2 position-relative">
                  <input type="text" class="form-control mb-2" id="synonym_filter" placeholder="筛选 / Filter">
                  <button role="button" class="position-absolute btn btn-close end-0 top-50 translate-middle" id="clear_synonym_filter"/>
                </div>
                <div id="synonym_preview" class="border py-1 px-3" style="white-space: pre-wrap; min-height: 100px; max-height: 30vh; overflow-y: scroll"></div>
              </div>
            </div>
          </div>
        </div>
        <div class="mb-4">
          <div role="button" class="mb-3" data-bs-toggle="collapse" data-bs-target="#label_tag_query">
            &#9658; 自动标签范围 / Auto Labeling For
          </div>
          <select id="label_tag_query"
            class="form-select select-custom-tags px-3 collapse show">
            <option value="未分類">未分类作品 / Uncategorized Only</option>
            <option value="">全部作品 / All Works</option>
          </select>
        </div>
        <div class="mb-4">
          <div role="button" class="mb-3" data-bs-toggle="collapse" data-bs-target="#advanced_label">&#9658; 高级设置 / Advanced</div>
          <div class="px-3 mb-4 collapse" id="advanced_label">
            <div class="mb-3">
              <label class="form-label fw-light" for="label_add_first">
                无匹配时是否自动添加首个标签
                <br />
                Whether the first tag will be added if there is not any match
              </label>
              <select id="label_add_first" class="form-select">
                <option value="false">否 / No</option>
                <option value="true">是 / Yes</option>
              </select>
            </div>
            <div class="mb-3">
              <label class="form-label fw-light" for="label_publication_type">
                作品公开类型
                <br />
                Publication Type for Labeling
              </label>
              <select id="label_publication_type" class="form-select select-custom-tags">
                <option value="show">公开 / Public</option>
                <option value="hide">私密 / Private</option>
              </select>
            </div>
            <div class="mb-4">
              <label class="form-label fw-light" for="label_retain_tag">
                是否保留之前的自定义标签
                <br />
                如果之前并非完全使用此脚本管理标签，并且没有设置同义词词典，将会覆盖掉自定义设置的标签
                <br />
                Whether the previous custom bookmark tags will be retained?
                <br />
                If you are not using the script to take fully control of your tags and haven't set your synonym dictionary, the custom tags will be overwritten.
              </label>
              <select id="label_retain_tag" class="form-select">
                <option value="true">保留 / Yes</option>
                <option value="false">舍弃 / No</option>
              </select>
            </div>
          </div>
        </div>
        <div class="my-5">
          <label class="form-label mb-2 fw-light">执行进度 / Progress</label>
          <div class="mb-3" id="label_prompt"></div>
          <div class="progress" id="progress" style="min-height: 1rem">
            <div style="width: 0" class="progress-bar progress-bar-striped"
             id="progress_bar" role="progressbar"></div>
          </div>
        </div>
        <button class="d-none" id="start_label_button"></button>
      </form>
      <div class="modal-footer">
        <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">关闭 / Close</button>
        <button type="button" class="btn btn-outline-danger me-3" style="white-space: nowrap"
          id="footer_stop_button">停止 / Stop
        </button>
        <button type="button" class="btn btn-outline-primary ms-auto" style="white-space: nowrap"
          id="footer_label_button">开始 / Start
        </button>
      </div>
    </div>
  `;

  // search
  const popupSearch = document.createElement("div");
  popupSearch.className = "modal fade";
  popupSearch.id = "search_modal";
  popupSearch.tabIndex = -1;
  popupSearch.innerHTML = `
    <div class="modal-dialog modal-xl d-flex flex-column bg-white" style="pointer-events: initial">
      <div class="modal-header">
        <h5 class="modal-title">搜索图片标签 / Search Bookmarks</h5>
        <button class="btn btn-close" data-bs-dismiss="modal" />
      </div>
      <form class="modal-body flex-grow-1 d-flex flex-column p-4" id="search_form">
          <div class="mb-4">
            <div class="mb-3">
              <label class="form-label" for="search_value">
                输入要搜索的关键字，使用空格分隔，在关键字前加<strong>感叹号</strong>来排除该关键字。将会结合用户设置的同义词词典，
                在收藏的图片中寻找标签匹配的图片展示在下方。当收藏时间跨度较大时，使用自定义标签缩小范围以加速搜索。
                <br />
                Enter keywords seperated by spaces to launch a search. Add a <strong>Question Mark</strong>
                before any keyword to exclude it. The search process will use your synonym dictionary to look up the tags
                of your bookmarked images. Use custom tag to narrow the search if images come from a wide time range.
              </label>
              <input type="text" class="form-control" id="search_value" required/>
            </div>
            <div class="mb-3" data-bs-toggle="collapse" data-bs-target="#advanced_search"
              type="button" id="advanced_search_controller">&#9658; 高级设置 / Advanced</div>
            <div class="mb-3 px-3 collapse" id="advanced_search">
              <div class="mb-2">
                <label class="form-label fw-light">标签匹配模式 / Match Pattern</label>
                <select class="form-select" id="search_exact_match">
                  <option value="fuzzy">模糊匹配 / Fuzzy Match</option>
                  <option value="exact">精确匹配 / Exact Match</option>
                </select>
              </div>
              <div class="mb-2">
                <label class="form-label fw-light">自定义标签用于缩小搜索范围 / Custom Tag to Narrow the Search</label>
                <select class="form-select select-custom-tags" id="search_select_tag">
                  <option value="">所有收藏 / All Works</option>
                </select>
              </div>
              <div class="mb-2">
                <label class="form-label fw-light">作品公开类型 / Publication Type</label>
                <select class="form-select" id="search_publication">
                  <option value="show">公开收藏 / Public</option>
                  <option value="hide">私密收藏 / Private</option>
                </select>
              </div>
            </div>
          </div>
          <div class="flex-grow-1">
            <div class="position-absolute start-50 top-50 spinner-border text-secondary" style="display: none" id="spinner">
            </div>
            <div class="row" id="search_results"/>
            </div>
            <div class="mb-2 text-end" id="search_prompt">
            </div>
            <button class="btn btn-outline-primary w-100 py-1" style="display: none;" id="search_more">继续搜索 / Search More</button>
          </div>
      </form>
      <div class="modal-footer">
        <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">关闭 / Close</button>
        <button type="button" class="btn btn-outline-primary ms-auto" style="white-space: nowrap"
          id="footer_search_button">搜索 / Search</button>
      </div>
    </div>
  `;

  const body = document.querySelector("body");
  body.appendChild(popupLabel);
  body.appendChild(popupSearch);
}

async function initializeVariables() {
  uid = unsafeWindow["dataLayer"][0]["user_id"];
  synonymDict = GM_getValue("synonymDict", {});

  const tagsRaw = await fetch(
    "https://www.pixiv.net/ajax/user/" + uid + "/illusts/bookmark/tags"
  );
  const tagsObj = await tagsRaw.json();
  if (tagsObj.error === true)
    return alert(
      `获取tags失败
    Fail to fetch user tags` +
        "\n" +
        decodeURI(tagsObj.message)
    );
  const userTagsSet = new Set();
  for (let obj of tagsObj.body.public) {
    userTagsSet.add(decodeURI(obj.tag));
  }
  for (let obj of tagsObj.body.private) {
    userTagsSet.add(decodeURI(obj.tag));
  }
  userTagsSet.delete("未分類");

  userTags = sortByParody(Array.from(userTagsSet));

  // get token
  const userRaw = await fetch(
    "https://www.pixiv.net/bookmark_add.php?type=illust&illust_id=83540927"
  );
  if (!userRaw.ok) {
    return alert(`获取身份信息失败
    Fail to fetch user information`);
  }
  const userRes = await userRaw.text();
  const tokenPos = userRes.indexOf("pixiv.context.token");
  const tokenEnd = userRes.indexOf(";", tokenPos);
  token = userRes.slice(tokenPos, tokenEnd).split('"')[1];

  if (!token) {
    console.log(`获取token失败
    Fail to fetch token`);
  }

  if (DEBUG) {
    console.log("uid:", uid);
    console.log("token", token);
    console.log("userTags:", userTags);
  }
}

function injectElements() {
  const root = document.querySelector("nav");
  root.classList.add("d-flex");
  const buttonContainer = document.createElement("span");
  buttonContainer.className = "flex-grow-1 justify-content-end";
  buttonContainer.style.display = "none";
  buttonContainer.id = "label_bookmarks_buttons";
  buttonContainer.innerHTML = `
        <button class="label-button" data-bs-toggle="modal" data-bs-target="#search_modal" id="search_modal_button"/>
        <button class="label-button" data-bs-toggle="modal" data-bs-target="#label_modal" id="label_modal_button"/>
      `;
  root.appendChild(buttonContainer);

  const removeTagText = unsafeWindow["dataLayer"][0].lang.includes("zh")
    ? "清除标签"
    : "Remove Tags";
  const removeButton = document.createElement("div");
  removeButton.className = "sc-1ij5ui8-0 QihHO sc-13ywrd6-7 tPCje";
  removeButton.setAttribute("aria-disabled", "true");
  removeButton.setAttribute("role", "button");
  removeButton.innerHTML = `<div aria-disabled="true" class="sc-4a5gah-0 kNlDsr">
            <div class="sc-4a5gah-1 kHyYuA">
              ${removeTagText}
            </div>
          </div>`;
  removeButton.addEventListener("click", removeBookmarkTags);

  const editButton = document.querySelector("div.sc-1dg0za1-4.iczOV");
  editButton.addEventListener(
    "click",
    () => {
      const section = document.querySelector("section.sc-jgyytr-0.buukZm");
      const editObserver = new MutationObserver(() => {
        const removeBookmarkContainer = document.querySelector(
          "div.sc-13ywrd6-4.cXBjgZ"
        );
        if (!removeBookmarkContainer) return;
        removeBookmarkContainer.appendChild(removeButton);
        const removeBookmarkContainerObserver = new MutationObserver(() => {
          const value =
            removeBookmarkContainer.children[2].getAttribute("aria-disabled");
          removeButton.setAttribute("aria-disabled", value);
          removeButton.children[0].setAttribute("aria-disabled", value);
        });
        removeBookmarkContainerObserver.observe(
          removeBookmarkContainer.children[2],
          { attributes: true }
        );
      });
      editObserver.observe(section, { childList: true });
    },
    { once: true }
  );
}

async function setElementProperties() {
  // label buttons
  const labelButton = document.querySelector("#label_modal_button");
  const searchButton = document.querySelector("#search_modal_button");
  if (unsafeWindow["dataLayer"][0].lang.includes("zh")) {
    labelButton.innerText = "添加标签";
    searchButton.innerText = "搜索图片";
  } else {
    labelButton.innerText = "Label";
    searchButton.innerText = "Search";
  }
  GM_addStyle(
    `.label-button {
         padding: 0 24px;
         background: transparent;
         font-size: 16px;
         font-weight: 700;
         border-top: 4px solid rgba(0, 150, 250, 0);
         border-bottom: none;
         border-left: none;
         border-right: none;
         color: rgba(0, 0, 0, 0.32);
         line-height: 24px;
         background: transparent;
         transition: color 0.4s ease 0s, border 0.4s ease 0s;
       }
       .label-button:hover {
         border-top: 4px solid rgb(0, 150, 250);
         color: rgba(0, 0, 0, 0.88);
       }`
  );

  // append user tags options
  const customSelects = [...document.querySelectorAll(".select-custom-tags")];
  customSelects.forEach((el) => {
    userTags.forEach((tag) => {
      const option = document.createElement("option");
      option.value = tag;
      option.innerText = tag;
      el.appendChild(option);
    });
  });

  // label bookmark form
  const labelForm = document.querySelector("#label_form");
  labelForm.onsubmit = handleLabel;
  const footerLabel = document.querySelector("#footer_label_button");
  const startLabel = document.querySelector("#start_label_button");
  footerLabel.onclick = () => startLabel.click();
  const stopButton = document.querySelector("#footer_stop_button");
  stopButton.onclick = () => (window.runFlag = false);

  // default value
  const addFirst = document.querySelector("#label_add_first");
  addFirst.value = GM_getValue("addFirst", "true");
  addFirst.onchange = () => GM_setValue("addFirst", addFirst.value);

  const tagToQuery = document.querySelector("#label_tag_query");
  const tag = GM_getValue("tagToQuery", "未分類");
  if (userTags.includes(tag)) tagToQuery.value = tag;
  // in case that tag has been deleted
  else tagToQuery.value = "未分類";
  tagToQuery.onchange = () => GM_setValue("tagToQuery", tagToQuery.value);

  const publicationType = document.querySelector("#label_publication_type");
  publicationType.value = GM_getValue("publicationType", "show");
  publicationType.onchange = () =>
    GM_setValue("publicationType", publicationType.value);

  const retainTag = document.querySelector("#label_retain_tag");
  retainTag.value = GM_getValue("retainTag", "false");
  retainTag.onchange = () => GM_setValue("retainTag", retainTag.value);

  // search bookmark form
  const searchForm = document.querySelector("#search_form");
  searchForm.onsubmit = handleSearch;
  const searchMore = document.querySelector("#search_more");
  const footerSearch = document.querySelector("#footer_search_button");
  footerSearch.onclick = () => searchMore.click();

  let synonymDictKeys = Object.keys(GM_getValue("synonymDict", {}));
  if (synonymDictKeys.length) {
    const index = Math.floor(Math.random() * synonymDictKeys.length);
    document
      .querySelector("#search_value")
      .setAttribute(
        "placeholder",
        "eg: " + synonymDictKeys[index].split("(")[0]
      );
  }

  let counter = 0;
  const id = setInterval(() => {
    counter++;
    const uidMatch = window.location.href.match(/\d+/);
    if (uidMatch && uidMatch[0] === uid) {
      document.querySelector("#label_bookmarks_buttons").style.display = "flex";
      clearInterval(id);
    } else if (counter > 100) {
      clearInterval(id);
    }
  }, 1000);
}

function setSynonymEventListener() {
  const targetTag = document.querySelector("#target_tag");
  const alias = document.querySelector("#tag_alias");
  const preview = document.querySelector("#synonym_preview");
  const buttons = document
    .querySelector("#synonym_buttons")
    .querySelectorAll("button");

  // update preview
  function updatePreview(synonymDict) {
    const newDict = {};
    for (let key of sortByParody(Object.keys(synonymDict))) {
      newDict[key] = synonymDict[key];
    }
    synonymDict = newDict;
    GM_setValue("synonymDict", synonymDict);
    let synonymString = "";
    for (let key of Object.keys(synonymDict)) {
      synonymString += key + "\n\t" + synonymDict[key].join(" ") + "\n\n";
    }
    preview.innerText = synonymString;
  }
  updatePreview(synonymDict);

  // on json file load
  document
    .querySelector("#synonym_dict_input")
    .addEventListener("change", (evt) => {
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          synonymDict = JSON.parse(evt.target.result.toString());
          GM_setValue("synonymDict", synonymDict);
          updatePreview(synonymDict);
        } catch (err) {
          alert("无法加载词典 / Fail to load dictionary\n" + err);
        }
      };
      reader.readAsText(evt.target.files[0]);
    });
  // export dict
  buttons[0].addEventListener("click", (evt) => {
    evt.preventDefault();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(
      new Blob([JSON.stringify(synonymDict)], {
        type: "application/json",
      })
    );
    a.setAttribute("download", "label_pixiv_bookmarks_synonym_dict.json");
    a.click();
  });
  // load alias
  buttons[1].addEventListener("click", (evt) => {
    evt.preventDefault();
    const targetValue = targetTag.value;
    for (let key of Object.keys(synonymDict)) {
      if (key === targetValue) {
        alias.value = synonymDict[key].join(" ");
        updatePreview(synonymDict);
      }
    }
  });
  // update the alias array
  buttons[2].addEventListener("click", (evt) => {
    evt.preventDefault();
    const targetValue = targetTag.value
      .split(" ")[0]
      .replace("（", "(")
      .replace("）", ")");
    navigator.clipboard.writeText(targetValue).catch(console.log);
    const aliasValue = alias.value;
    if (aliasValue === "") {
      // delete
      if (synonymDict[targetValue]) {
        delete synonymDict[targetValue];
      }
    } else {
      // update
      synonymDict[targetValue] = aliasValue.trim().split(" ");
    }
    targetTag.value = "";
    alias.value = "";
    GM_setValue("synonymDict", synonymDict);
    updatePreview(synonymDict);
  });
  // filter
  document
    .querySelector("input#synonym_filter")
    .addEventListener("input", (evt) => {
      const filter = evt.target.value;
      if (filter.length) {
        if (filter === " ") return;
        const filteredKeys = Object.keys(synonymDict).filter((key) =>
          key.toUpperCase().includes(filter.toUpperCase())
        );
        const newDict = {};
        for (let key of filteredKeys) {
          newDict[key] = synonymDict[key];
        }
        updatePreview(newDict);
      } else {
        updatePreview(synonymDict);
      }
    });
  // clear
  document
    .querySelector("button#clear_synonym_filter")
    .addEventListener("click", () => {
      document.querySelector("input#synonym_filter").value = "";
      updatePreview(synonymDict);
    });
}

(function () {
  "use strict";
  loadResources();
  createModalElements();
  const intervalId = setInterval(() => {
    if (document.querySelector("nav")) {
      clearInterval(intervalId);
      initializeVariables()
        .then(injectElements)
        .then(setElementProperties)
        .then(setSynonymEventListener);
    }
  }, 1000);
})();
