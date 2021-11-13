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
// @resource     bootstrapIcon https://cdn.jsdelivr.net/npm/bootstrap-icons@1.7.0/font/bootstrap-icons.css
// @resource     bootstrapCSS https://cdn.jsdelivr.net/npm/bootstrap@5.0.1/dist/css/bootstrap.min.css
// @resource     bootstrapJS https://cdn.jsdelivr.net/npm/bootstrap@5.0.2/dist/js/bootstrap.bundle.min.js
// @grant        unsafeWindow
// @grant        GM_getResourceURL
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @license      MIT

// ==/UserScript==

let uid, userTags;

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

const delay = (ms) => new Promise((res) => setTimeout(res, ms));

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

async function handleUpdate(
  token,
  illust_id,
  tags,
  retainComment,
  retainTag,
  restricted
) {
  const PIXIV_API_URL = "https://www.pixiv.net/rpc/index.php";
  const mode = "save_illust_bookmark";

  let comment, newTags;
  // get comment from the detailed page
  if (retainComment || retainTag) {
    const docRaw = await fetch(
      "https://www.pixiv.net/bookmark_add.php?type=illust&illust_id=" +
        illust_id
    );
    const docRes = await docRaw.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(docRes, "text/html");
    comment = doc.querySelector("div.input-box.ui-counter").firstElementChild
      .value;
    const previousTags = doc
      .querySelector("div.input-box.tags")
      .firstElementChild.value.trim()
      .split(" ");
    // remove the duplicate
    newTags = Array.from(new Set(tags.concat(previousTags)))
      .slice(0, 10)
      .join("+");
  } else {
    comment = "";
    newTags = tags.join("+");
  }
  console.log(comment, newTags);

  await fetch(PIXIV_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    },
    credentials: "same-origin",
    body: [
      `mode=${mode}`,
      `illust_id=${illust_id}`,
      `restrict=${restricted ? 1 : 0}`,
      "comment" + (comment ? `=${comment}` : ""),
      "tags" + (newTags ? `=${newTags}` : ""),
      `tt=${token}`,
    ].join("&"),
  });
}

async function handleStart(
  addFirst,
  addSAFE,
  tagToQuery,
  retainComment,
  retainTag,
  publicationType,
  synonymDict
) {
  console.log("Configuration:");
  console.log(
    "addFirst",
    addFirst,
    "addSAFE",
    addSAFE,
    "tag",
    tagToQuery,
    "retainComment",
    retainComment,
    "retainTag",
    retainTag,
    "publicationType",
    publicationType
  );

  window.runFlag = true;
  const promptBottom = document.querySelector("#prompt");
  promptBottom.innerText = `处理中，请勿关闭窗口
  Processing. Please do not close the window.
  `;
  const objDiv = document.querySelector("#popup > div");
  objDiv.scrollTop = objDiv.scrollHeight;

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
  const token = userRes.slice(tokenPos, tokenEnd).split('"')[1];
  console.log("token:", token);

  if (!token) {
    console.log(`获取token失败
    Fail to fetch token`);
  }

  // fetch bookmarks
  let total,
    index = 0,
    offset = 0;
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
    console.log(bookmarks);
    if (!total) {
      total = bookmarks.total;
    }
    for (let work of bookmarks.works) {
      console.log(index, work.title, work.id);
      // ---- means unavailable, hidden or deleted by author
      if (work.title !== "-----") {
        const illust_id = work.id;
        const workTags = work.tags;
        let intersection = userTags.filter((userTag) => {
          // if work tags includes this user tag
          if (
            workTags.includes(userTag) ||
            workTags.includes(userTag.split("(")[0])
          )
            return true;
          // if work tags match an user alias (exact match)
          return (
            synonymDict[userTag] &&
            synonymDict[userTag].find(
              (alias) =>
                workTags.includes(alias) ||
                workTags.includes(alias.split("(")[0])
            )
          );
        });
        // if workTags match some alias, add it to the intersection (exact match, with or without parody name)
        intersection = intersection.concat(
          workTags
            .map((workTag) => {
              for (let aliasName of Object.keys(synonymDict)) {
                if (
                  synonymDict[aliasName].includes(workTag) ||
                  synonymDict[aliasName].includes(workTag.split("(")[0])
                )
                  return aliasName;
              }
            })
            .filter((i) => i)
        );
        // remove duplicate
        intersection = Array.from(new Set(intersection));
        // pixiv limits
        if (intersection.length > 10) {
          intersection = intersection.slice(0, 10);
        }
        if (addFirst === "true") {
          if (intersection.length === 0) {
            intersection.push(workTags[0]);
            userTags.push(workTags[0]);
          }
        }
        if (addSAFE === "true") {
          if (!workTags.includes("R-18") && !workTags.includes("R-18G")) {
            intersection.push("SAFE");
          }
        }
        // only if the tags need to be modified
        // skip those unavailable links
        if (intersection.length !== 0) {
          await handleUpdate(
            token,
            illust_id,
            intersection,
            retainComment === "true",
            retainTag === "true",
            publicationType === "show" ? 0 : 1
          );
        } else {
          offset++;
        }
      }
      // work is not available now, skip
      else {
        offset++;
      }
      index++;
      if (!window.runFlag) {
        promptBottom.innerText = `检测到停止信号，程序已停止运行
  Stop signal detected. Program exits.
  `;
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
    document.querySelector(
      "#prompt"
    ).innerText = `自动添加标签已完成，请关闭窗口并刷新网页
  Auto labeling finished successfully. Please close the window and refresh.
  `;
  }
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
    Fail to fetch user bookmarks` +
        "\n" +
        decodeURI(bookmarksRes.message)
    );
  } else return bookmarksRes.body;
}

let searchBatch = 200,
  searchString = "",
  searchResults = [],
  searchOffset = 0,
  totalBookmarks = 0;
async function handleSearch(evt) {
  evt.preventDefault();

  const searchString_ = document
    .querySelector("#search_value")
    .value.replace(/！/g, "!");

  // initialize new search
  const resultsDiv = document.querySelector("#search_results");
  const noResult = document.querySelector("#no_result");
  if (noResult) resultsDiv.removeChild(noResult);
  if (searchString_ !== searchString) {
    searchString = searchString_;
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

  bootstrap.Collapse.getInstance(
    document.querySelector("#advanced_search")
  ).hide();

  let includeArray = searchString
    .split(" ")
    .filter((el) => el.length && !el.includes("!"));
  let excludeArray = searchString
    .split(" ")
    .filter((el) => el.length && el.includes("!"))
    .map((el) => el.slice(1));

  const matchPattern = document.querySelector("#search_exact_match").value;
  const tagToQuery = document.querySelector("#search_select_tag").value;
  const publicationType = document.querySelector("#search_publication").value;

  // TODO
  console.log(
    matchPattern,
    tagToQuery,
    publicationType,
    includeArray,
    excludeArray
  );

  const dict = GM_getValue("synonymDict", {});
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
    console.log(bookmarks);
    if (!totalBookmarks) {
      totalBookmarks = bookmarks.total;
    }
    for (let work of bookmarks.works) {
      console.log(searchOffset, work.title, work.id, work.tags);
      index++;
      searchOffset++;

      if (work.title === "-----") continue;
      const workTags = work.tags;

      const ifInclude = (keyword) => {
        // especially, R-18 tag is labelled in work
        if (["R-18", "R18", "r18"].includes(keyword)) return work["xRestrict"];

        // keywords from user input, alias from dict
        // keyword: 新世纪福音战士
        // alias: EVA eva
        const el = Object.keys(dict)
          .map((i) => [i.split("(")[0], i])
          .find(
            (el) =>
              el[0] === keyword ||
              (matchPattern === "fuzzy" && el[0].includes(keyword))
          );
        const keywordArray = el ? dict[el[1]].concat(keyword) : [keyword];
        if (
          keywordArray.some((kw) => workTags.includes(kw)) ||
          keywordArray.some(
            (
              kw // remove work tag braces
            ) => workTags.map((tag) => tag.split("(")[0]).includes(kw)
          )
        )
          return true;
        if (matchPattern === "exact") return false;
        return keywordArray.some(
          (kw) =>
            workTags.some((tag) => tag.includes(kw)) ||
            keywordArray.some(
              (
                kw // remove work tag braces
              ) =>
                workTags
                  .map((tag) => tag.split("(")[0])
                  .some((tag) => tag.includes(kw))
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

(function () {
  "use strict";
  document.head.appendChild(cssElement(GM_getResourceURL("bootstrapIcon")));
  document.head.appendChild(cssElement(GM_getResourceURL("bootstrapCSS")));
  document.head.appendChild(jsElement(GM_getResourceURL("bootstrapJS")));
  if (window.location.href.includes("https://www.pixiv.net/bookmark.php")) {
    const h1Elements = document.querySelectorAll("h1");
    for (let el of h1Elements) {
      el.style.fontSize = "1rem";
    }
  }

  const shade = document.createElement("div");
  shade.className = "position-fixed";
  shade.style.width = "100vw";
  shade.style.height = "100vh";
  shade.style.background = "rgba(0,0,0,0.2)";
  shade.style.left = "0";
  shade.style.top = "0";
  shade.style.display = "none";
  shade.style.opacity = "0";
  shade.style.transition = "opacity 0.2s ease 0s";

  const popupLabel = document.createElement("div");
  popupLabel.style.width = "47rem";
  popupLabel.style.position = "fixed";
  popupLabel.style.left = "calc(50vw - 24rem)";
  if (window.matchMedia("(min-height: 60rem)").matches) {
    popupLabel.style.minHeight = "50rem";
    popupLabel.style.maxHeight = "90vh";
    popupLabel.style.top = "5vh";
  } else {
    popupLabel.style.maxHeight = "calc(100vh - 2rem)";
    popupLabel.style.top = "1rem";
  }
  popupLabel.style.overflowX = "hidden";
  popupLabel.style.background = "rgb(245,245,245)";
  popupLabel.style.display = "none";
  popupLabel.style.opacity = "0";
  popupLabel.className =
    "py-3 px-4 rounded border border-secondary flex-column";
  popupLabel.id = "popup";
  popupLabel.style.transition = "opacity 0.2s ease 0s";

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
            <div class="mb-3 ps-3 collapse" id="advanced_search">
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
        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">关闭 / Close</button>
        <button type="button" class="btn btn-outline-primary ms-auto" style="white-space: nowrap"
          id="footer_search_button">搜索 / Search</button>
      </div>
    </div>
  `;

  shade.addEventListener("click", () => {
    popupLabel.style.opacity = "0";
    shade.style.opacity = "0";
    setTimeout(() => {
      popupLabel.style.display = "none";
      shade.style.display = "none";
    }, 200);
  });

  const inner = document.createElement("div");
  inner.style.width = "48rem";
  inner.style.paddingLeft = "0.2rem";
  inner.style.paddingRight = "3rem";
  inner.style.overflowY = "scroll";

  const closeDiv = document.createElement("div");
  closeDiv.className = "d-flex justify-content-end mb-3";
  const close = document.createElement("button");
  close.className = "btn btn-close";
  close.addEventListener("click", () => {
    popupLabel.style.opacity = "0";
    shade.style.opacity = "0";
    setTimeout(() => {
      popupLabel.style.display = "none";
      shade.style.display = "none";
    }, 200);
  });
  closeDiv.appendChild(close);

  const promptTop = document.createElement("div");
  promptTop.className = "flex-grow-1 text-center mb-4";
  promptTop.innerHTML = `
    <div>如果对以下配置有疑惑，请参考
      <a href="https://greasyfork.org/zh-CN/scripts/423823-pixiv%E6%94%B6%E8%97%8F%E5%A4%B9%E8%87%AA%E5%8A%A8%E6%A0%87%E7%AD%BE?locale_override=1" style="text-decoration: underline"
      target="_blank" rel="noreferrer">文档</a>
    </div>
    <div>Please refer to the
      <a href="https://greasyfork.org/en/scripts/423823-pixiv%E6%94%B6%E8%97%8F%E5%A4%B9%E8%87%AA%E5%8A%A8%E6%A0%87%E7%AD%BE" style="text-decoration: underline"
       target="_blank" rel="noreferrer">document</a> if confused.
    </div>`;

  const select0 = document.createElement("select");
  select0.id = "select0";
  select0.className = "form-select mb-4";
  const label0 = document.createElement("label");
  label0.htmlFor = "select0";
  label0.innerText = `无匹配时是否自动添加首个标签
    Whether the first tag will be added if there is not any match
    `;
  label0.className = "form-label mb-3 fw-light";
  const option00 = document.createElement("option");
  option00.innerText = "否 / No";
  option00.value = "false";
  const option01 = document.createElement("option");
  option01.innerText = "是 / Yes";
  option01.value = "true";
  select0.appendChild(option00);
  select0.appendChild(option01);

  const select1 = document.createElement("select");
  select1.id = "select1";
  select1.className = "form-select mb-4";
  const label1 = document.createElement("label");
  label1.htmlFor = "select1";
  label1.innerText = `是否为非R18作品自动添加"SAFE"标签
    Whether the "SAFE" tag will be added to non-R18 works
    `;
  label1.className = "form-label mb-3 fw-light";
  const option10 = document.createElement("option");
  option10.innerText = "否 / No";
  option10.value = "false";
  const option11 = document.createElement("option");
  option11.innerText = "是 / Yes";
  option11.value = "true";
  select1.appendChild(option10);
  select1.appendChild(option11);

  const select2 = document.createElement("select");
  select2.id = "select2";
  select2.className = "form-select mb-4";
  const label2 = document.createElement("label");
  label2.htmlFor = "select2";
  label2.innerText = `自动标签范围
    Auto Labeling For
  `;
  label2.className = "form-label mb-3 fw-light";
  const option20 = document.createElement("option");
  option20.innerText = "未分类作品 / Uncategorized Only";
  option20.value = "未分類";
  const option21 = document.createElement("option");
  option21.innerText = "全部作品 / All Works";
  option21.value = "";
  const option22 = document.createElement("option");
  option22.innerText = "自定义标签 / Custom Tag";
  option22.value = "custom";
  select2.appendChild(option20);
  select2.appendChild(option21);
  select2.appendChild(option22);
  select2.addEventListener("change", () => {
    const div = document.querySelector("#input_div_0");
    if (select2.value === "custom") {
      div.style.display = "block";
    } else {
      div.style.display = "none";
    }
  });

  const inputDiv0 = document.createElement("div");
  inputDiv0.id = "input_div_0";
  inputDiv0.className = "mb-4";
  const s2Value = GM_getValue("tagToQuery", "未分類");
  if (s2Value === "未分類" || s2Value === "") inputDiv0.style.display = "none";
  else inputDiv0.style.display = "block";
  const input0 = document.createElement("input");
  input0.id = "input0";
  input0.className = "form-control";
  const labelInput0 = document.createElement("label");
  labelInput0.htmlFor = "input0";
  labelInput0.innerText = `自定义标签
  Custom Tag
  `;
  labelInput0.className = "form-label mb-3 fw-light";
  inputDiv0.appendChild(labelInput0);
  inputDiv0.appendChild(input0);

  const select3 = document.createElement("select");
  select3.id = "select3";
  select3.className = "form-select mb-4";
  const label3 = document.createElement("label");
  label3.htmlFor = "select3";
  label3.innerText = `是否保留收藏评论（可能会降低性能）
    Whether the bookmark comment will be retained? (May reduce the performance)
  `;
  label3.className = "form-label mb-3 fw-light";
  const option30 = document.createElement("option");
  option30.innerText = "舍弃 / No";
  option30.value = "false";
  const option31 = document.createElement("option");
  option31.innerText = "保留 / Yes";
  option31.value = "true";
  select3.appendChild(option30);
  select3.appendChild(option31);

  const select5 = document.createElement("select");
  select5.id = "select5";
  select5.className = "form-select mb-4";
  const label5 = document.createElement("label");
  label5.htmlFor = "select5";
  label5.innerText = `是否保留之前的自定义标签（可能会降低性能）
  如果之前并非完全使用此脚本管理标签，并且没有设置同义词词典，将会覆盖掉自定义设置的标签
  Whether the previous custom bookmark tags will be retained? (May reduce the performance)
  If you are not using the script to take fully control of your tags and haven't set your synonym dictionary, the custom tags will be overwritten.
  `;
  label5.className = "form-label mb-3 fw-light";
  const option50 = document.createElement("option");
  option50.innerText = "舍弃 / No";
  option50.value = "false";
  const option51 = document.createElement("option");
  option51.innerText = "保留 / Yes";
  option51.value = "true";
  select5.appendChild(option50);
  select5.appendChild(option51);

  const select4 = document.createElement("select");
  select4.id = "select4";
  select4.className = "form-select mb-4";
  const label4 = document.createElement("label");
  label4.htmlFor = "select4";
  label4.innerText = `作品公开类型
  Publication Type for Labeling
  `;
  label4.className = "form-label mb-3 fw-light";
  const option40 = document.createElement("option");
  option40.innerText = "公开 / Public";
  option40.value = "show";
  const option41 = document.createElement("option");
  option41.innerText = "私密 / Private";
  option41.value = "hide";
  select4.appendChild(option40);
  select4.appendChild(option41);

  const synonymContainer = document.createElement("div");
  synonymContainer.innerHTML = `
  <div class="mb-3">
    <button class="btn btn-outline-primary w-100 mb-3" data-bs-toggle="collapse" data-bs-target="#synonym_content">同义词词典 / Synonym Dict</button>
    <div class="collapse p-3 border" id="synonym_content">
      <div class="mb-3">
        使用前请参考文档中关于同义词词典功能的部分
        <br />
        Please refer to the document about what is the synonym dictionary before use it
      </div>
      <label class="form-label fw-light" for="synonym_dict_input">
        加载词典文件 / Load Dictionary
      </label>
      <input class="form-control border mb-3" type="file" accept="application/json" id="synonym_dict_input"/>
      <label class="form-label fw-light" for="target_tag">目标标签（用户标签） / Target Tag (User Tag)</label>
      <input class="form-control mb-3" type="text" id="target_tag" placeholder="eg: 新世紀エヴァンゲリオン">
      <label class="form-label fw-light" for="tag_alias">同义词（作品标签，空格分割） / Alias (From Artwork, Space Delimited)</label>
      <input class="form-control mb-3" type="text" id="tag_alias" placeholder="eg: エヴァンゲリオン evangelion Evangelion eva EVA">
      <div class="d-flex mb-3" id="synonym_buttons">
        <button class="btn btn-outline-primary me-auto">导出词典 / Export Dict</button>
        <button class="btn btn-outline-primary me-3">加载标签 / Load Tag</button>
        <button class="btn btn-outline-primary">更新标签 / Update Tag</button>
      </div>
      <div class="mb-2 fw-light d-flex">
        <div class="me-auto">预览 / Preview</div>
        <div role="button" style="text-decoration: underline" id="sort_synonym">排序 / Sort</div>
      </div>
      <div class="mb-2 position-relative">
        <input type="text" class="form-control mb-2" id="synonym_filter" placeholder="筛选 / Filter">
        <button class="position-absolute btn btn-close end-0 top-50 translate-middle" id="clear_synonym_filter"/>
      </div>
      <div id="synonym_preview" class="border py-1 px-3" style="white-space: pre-wrap; min-height: 100px; max-height: 400px; overflow-y: scroll"/>
    </div>
  </div>
  `;
  let synonymDict = GM_getValue("synonymDict", {});
  function loadSynonymEventListener() {
    const targetTag = document.querySelector("#target_tag");
    const alias = document.querySelector("#tag_alias");
    const preview = document.querySelector("#synonym_preview");
    const buttons = document
      .querySelector("#synonym_buttons")
      .querySelectorAll("button");
    // update preview
    function updatePreview(synonymDict) {
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
    // sort
    document.querySelector("#sort_synonym").addEventListener("click", () => {
      const newDict = {};
      for (let key of sortByParody(Object.keys(synonymDict))) {
        newDict[key] = synonymDict[key];
      }
      synonymDict = newDict;
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

  const inputDiv1 = document.createElement("div");
  inputDiv1.id = "input_div_1";
  inputDiv1.className = "mb-4";
  inputDiv1.style.display = "none";
  const input1 = document.createElement("input");
  input1.id = "input1";
  input1.className = "form-control";
  const labelInput1 = document.createElement("label");
  labelInput1.htmlFor = "input1";
  labelInput1.innerText = `自定义标签
  Custom Tag
  `;
  labelInput1.className = "form-label mb-3 fw-light";
  inputDiv1.appendChild(labelInput1);
  inputDiv1.appendChild(input1);

  const labelProgress = document.createElement("label");
  const progress = document.createElement("div");
  const progressBar = document.createElement("div");
  progress.id = "progress";
  progress.style.minHeight = "1rem";
  progress.className = "progress mb-4";
  progressBar.className =
    "progress-bar progress-bar-striped progress-bar-animated";
  progressBar.role = "progressbar";
  progressBar.id = "progress_bar";
  progressBar.style.width = "0";
  labelProgress.htmlFor = "progress";
  labelProgress.innerText = `执行进度
  Progress`;
  labelProgress.className = "form-label mb-3 fw-light";
  progress.appendChild(progressBar);

  const promptBottom = document.createElement("div");
  promptBottom.className = "flex-grow-1 text-center mb-5";
  promptBottom.id = "prompt";

  const buttonDiv = document.createElement("div");
  buttonDiv.className = "d-flex my-4";
  const closeButton = document.createElement("button");
  closeButton.innerText = "Close";
  closeButton.className = "btn btn-secondary me-auto";
  closeButton.addEventListener("click", () => {
    popupLabel.style.display = "none";
    shade.style.display = "none";
  });
  const stopButton = document.createElement("button");
  stopButton.innerText = "Stop";
  stopButton.className = "btn btn-danger me-3";
  stopButton.addEventListener("click", () => {
    window.runFlag = false;
  });
  const initButton = document.createElement("button");
  initButton.innerText = "Start";
  initButton.className = "btn btn-primary";
  // entry
  initButton.addEventListener("click", () => {
    handleStart(
      select0.value,
      select1.value,
      input0.value === "" ? select2.value : input0.value,
      select3.value,
      select5.value,
      select4.value,
      synonymDict
    ).catch(alert);
  });
  buttonDiv.appendChild(closeButton);
  buttonDiv.appendChild(stopButton);
  buttonDiv.appendChild(initButton);

  inner.appendChild(closeDiv);
  inner.appendChild(promptTop);
  inner.appendChild(label0);
  inner.appendChild(select0);
  inner.appendChild(label1);
  inner.appendChild(select1);
  inner.appendChild(label2);
  inner.appendChild(select2);
  inner.appendChild(inputDiv0);
  inner.appendChild(label3);
  inner.appendChild(select3);
  inner.appendChild(label5);
  inner.appendChild(select5);
  inner.appendChild(label4);
  inner.appendChild(select4);
  inner.appendChild(synonymContainer);
  inner.appendChild(labelProgress);
  inner.appendChild(progress);
  inner.appendChild(promptBottom);
  inner.appendChild(buttonDiv);
  popupLabel.appendChild(inner);

  // button to start labeling
  let root;
  const intervalId = setInterval(() => {
    let rootClass;
    if (window.location.href.includes("https://www.pixiv.net/bookmark.php")) {
      // old UI
      rootClass = ".column-menu";
      for (let el of document.querySelectorAll("ul")) {
        el.classList.add("mb-0");
        el.classList.add("ps-0");
      }
      for (let el of document.querySelectorAll("a")) {
        el.style.color = "#258fb8";
        el.style.textDecoration = "none";
      }
      for (let el of document.querySelectorAll(".adsbygoogle")) {
        el.style.display = "none";
      }
    } else {
      rootClass = "nav";
    }
    root = document.querySelector(rootClass);
    if (root) {
      clearInterval(intervalId);
      root.classList.add("d-flex");
      const container = document.createElement("span");
      container.className = "flex-grow-1 justify-content-end";
      container.style.display = "none";
      container.id = "label_bookmarks_buttons";
      container.innerHTML = `
        <button class="label-button" id="add_label"/>
        <button class="label-button" data-bs-toggle="modal" data-bs-target="#search_modal" id="search_label"/>
      `;

      const body = document.querySelector("body");
      root.appendChild(container);
      body.appendChild(shade);
      body.appendChild(popupLabel);
      body.appendChild(popupSearch);

      loadSynonymEventListener();
      setButtonProperties().catch(console.log);

      // set default value
      select0.value = GM_getValue("addFirst", "true");
      select0.addEventListener("change", () => {
        GM_setValue("addFirst", select0.value);
      });

      select1.value = GM_getValue("addSAFE", "false");
      select1.addEventListener("change", () =>
        GM_setValue("addSAFE", select1.value)
      );

      const s2Value = GM_getValue("tagToQuery", "未分類");
      if (s2Value === "未分類" || s2Value === "") select2.value = s2Value;
      else select2.value = "custom";
      select2.addEventListener("change", () => {
        if (select2.value === "未分類" || select2.value === "")
          GM_setValue("tagToQuery", select2.value);
      });
      if (s2Value !== "未分類" && s2Value !== "") input0.value = s2Value;
      input0.addEventListener("change", () =>
        GM_setValue("tagToQuery", input0.value)
      );

      select3.value = GM_getValue("retainComment", "false");
      select3.addEventListener("change", () =>
        GM_setValue("retainComment", select3.value)
      );

      select5.value = GM_getValue("retainTag", "false");
      select5.addEventListener("change", () =>
        GM_setValue("retainTag", select5.value)
      );

      select4.value = GM_getValue("publicationType", "show");
      select4.addEventListener("change", () =>
        GM_setValue("publicationType", select4.value)
      );

      // if synonymDict is loaded, expand
      if (Object.keys(synonymDict).length) {
        const content = document.querySelector("#synonym_content");
        content.className = "p-3 border collapse show";
      }
    }
  }, 1000);

  async function setButtonProperties() {
    // label buttons
    const labelButton = document.querySelector("#add_label");
    const searchButton = document.querySelector("#search_label");
    if (unsafeWindow.dataLayer[0].lang.includes("zh")) {
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
          }`
    );
    if (window.location.href.includes("https://www.pixiv.net/bookmark.php")) {
      GM_addStyle(
        `.label-button {
              border: none;
              color: #258fb8;
          }`
      );
    } else {
      GM_addStyle(
        `.label-button {
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
    }
    labelButton.addEventListener("click", () => {
      popupLabel.style.display = "flex";
      shade.style.display = "flex";
      setTimeout(() => {
        popupLabel.style.opacity = "1";
        shade.style.opacity = "1";
      }, 100);
    });

    // search bookmark form
    const searchForm = document.querySelector("#search_form");
    searchForm.onsubmit = handleSearch;
    const searchMore = document.querySelector("#search_more");
    const footerSearch = document.querySelector("#footer_search_button");
    footerSearch.onclick = () => searchMore.click();

    //
    uid = unsafeWindow.dataLayer[0]["user_id"];
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

    console.log("uid:", uid, "userTags:", userTags);

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
        document.querySelector("#label_bookmarks_buttons").style.display =
          "flex";
        clearInterval(id);
      } else if (counter > 100) {
        clearInterval(id);
      }
    }, 1000);
  }
})();
