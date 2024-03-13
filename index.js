// ==UserScript==
// @name         Pixiv收藏夹自动标签
// @name:en      Label Pixiv Bookmarks
// @namespace    http://tampermonkey.net/
// @version      5.15
// @description  自动为Pixiv收藏夹内图片打上已有的标签，并可以搜索收藏夹
// @description:en    Automatically add existing labels for images in the bookmarks, and users are able to search the bookmarks
// @author       philimao
// @match        https://www.pixiv.net/*users/*
// @icon         https://www.google.com/s2/favicons?domain=pixiv.net
// @resource     bootstrapCSS https://cdn.jsdelivr.net/npm/bootstrap@5.2.0-beta1/dist/css/bootstrap.min.css
// @resource     bootstrapJS https://cdn.jsdelivr.net/npm/bootstrap@5.2.0-beta1/dist/js/bootstrap.bundle.min.js
// @grant        unsafeWindow
// @grant        GM_getResourceURL
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @license      MIT

// ==/UserScript==

const version = "5.15";
const latest = `♢ 新增批量为失效作品添加INVALID标签功能（在其他功能中）
♢ Added Functions to label deleted/private works as INVALID (Function Page)
♢ 新增加速模式选项，通过移除请求间的等待时间加速脚本运行（在其他功能中）
♢ Added Turbo Mode that removes most delay time between requests to increase the speed of the script (Function Page)`;

let uid,
  token,
  lang,
  userTags,
  userTagDict,
  synonymDict,
  pageInfo,
  theme,
  showWorkTags,
  generator,
  // workType,
  feature,
  turboMode,
  cachedBookmarks = {},
  DEBUG;
// noinspection TypeScriptUMDGlobal,JSUnresolvedVariable
let unsafeWindow_ = unsafeWindow,
  GM_getValue_ = GM_getValue,
  GM_setValue_ = GM_setValue,
  GM_addStyle_ = GM_addStyle,
  GM_getResourceURL_ = GM_getResourceURL,
  GM_registerMenuCommand_ = GM_registerMenuCommand;

// selectors
const BANNER = ".sc-x1dm5r-0";
const THEME_CONTAINER = ".charcoal-token";
const PAGE_BODY = ".jMEnyM"; // 自主页、收藏起下方
const EDIT_BUTTON_CONTAINER = ".fElfQf"; // 管理收藏按钮
const WORK_NUM = ".sc-1mr081w-0";
const ADD_TAGS_MODAL_ENTRY = ".bbTNLI"; // 原生添加标签窗口中标签按钮
const ALL_TAGS_BUTTON = ".jkGZFM"; // 标签切换窗口触发按钮
const ALL_TAGS_CONTAINER = ".hpRxDJ"; // 标签按钮容器
const ALL_TAGS_MODAL = ".ggMyQW"; // 原生标签切换窗口
const ALL_TAGS_MODAL_CONTAINER = ".gOPhqx"; // 原生标签切换窗口中标签按钮容器

function getCharacterName(tag) {
  return tag.split("(")[0];
}

function getWorkTitle(tag) {
  return (tag.split("(")[1] || "").split(")")[0];
}

function stringIncludes(s1, s2) {
  const isString = (s) => typeof s === "string" || s instanceof String;
  if (!isString(s1) || !isString(s2))
    throw new Error("Argument is not a string");
  return s1.includes(s2);
}

function arrayIncludes(array, element, func1, func2, fuzzy) {
  if (!Array.isArray(array))
    throw new TypeError("First argument is not an array");
  let array1 = func1 ? array.map(func1) : array;
  let array2 = Array.isArray(element) ? element : [element];
  array2 = func2 ? array2.map(func2) : array2;
  const el = [...array1, ...array2].find((i) => !i.toUpperCase);
  if (el) {
    console.log(el, array, element);
    throw new TypeError(
      `Element ${el.toString()} does not have method toUpperCase`
    );
  }
  array1 = array1.map((i) => i.toUpperCase());
  array2 = array2.map((i) => i.toUpperCase());
  if (fuzzy)
    return array2.every((i2) => array1.some((i1) => stringIncludes(i1, i2)));
  else return array2.every((i) => array1.includes(i));
}

function isEqualObject(obj1, obj2) {
  if (typeof obj1 !== "object") return obj1 === obj2;
  return (
    typeof obj1 === typeof obj2 &&
    Object.keys(obj1).every((key, i) => key === Object.keys(obj2)[i]) &&
    Object.values(obj1).every((value, i) =>
      isEqualObject(value, Object.values(obj2)[i])
    )
  );
}

function delay(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

function chunkArray(arr, chunkSize) {
  return Array.from({ length: Math.ceil(arr.length / chunkSize) }, (_, index) =>
    arr.slice(index * chunkSize, index * chunkSize + chunkSize)
  );
}

function getValue(name, defaultValue) {
  return GM_getValue_(name, defaultValue);
}

function setValue(name, value) {
  if (name === "synonymDict" && (!value || !Object.keys(value).length)) return;
  GM_setValue_(name, value);
  // backup
  let valueArray = JSON.parse(window.localStorage.getItem(name));
  if (!valueArray) valueArray = [];
  // save the dict by date
  if (name === "synonymDict") {
    const date = new Date().toLocaleDateString();
    // not update if of same value
    if (valueArray.length) {
      if (
        !valueArray.find(
          (el) => JSON.stringify(el.value) === JSON.stringify(value)
        )
      ) {
        const lastElem = valueArray[valueArray.length - 1];
        if (lastElem.date === date) {
          // append only
          for (let key of Object.keys(value)) {
            if (lastElem.value[key]) {
              // previous key
              lastElem.value[key] = Array.from(
                new Set(lastElem["value"][key].concat(value[key]))
              );
            } else {
              // new key
              lastElem.value[key] = value[key];
            }
          }
          valueArray.pop();
          valueArray.push(lastElem);
        } else {
          if (valueArray.length > 30) valueArray.shift();
          valueArray.push({ date, value });
        }
        window.localStorage.setItem(name, JSON.stringify(valueArray));
      } else {
        // same value, pass
      }
    } else {
      // empty array
      valueArray.push({ date, value });
      window.localStorage.setItem(name, JSON.stringify(valueArray));
    }
  } else {
    if (valueArray.length > 30) valueArray.shift();
    valueArray.push(value);
    window.localStorage.setItem(name, JSON.stringify(valueArray));
  }
}

function addStyle(style) {
  GM_addStyle_(style);
}

// merge all previous dict and return
function restoreSynonymDict() {
  const value = window.localStorage.getItem("synonymDict");
  if (!value) return {};
  const dictArray = JSON.parse(value);
  const newDict = {};
  for (let elem of dictArray) {
    const dict = elem.value;
    // merge all history value for the key
    Object.keys(dict).forEach((key) => {
      if (newDict[key])
        newDict[key] = Array.from(new Set(newDict[key].concat(dict[key])));
      else newDict[key] = dict[key];
    });
  }

  const a = document.createElement("a");
  a.href = URL.createObjectURL(
    new Blob([JSON.stringify([newDict].concat(dictArray))], {
      type: "application/json",
    })
  );
  a.setAttribute(
    "download",
    `synonym_dict_restored_${new Date().toLocaleDateString()}.json`
  );
  a.click();
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
    link.id = "bootstrapCSS";
    link.href = url;
    link.rel = "stylesheet";
    link.type = "text/css";
    return link;
  }
  function jsElement(url) {
    const script = document.createElement("script");
    script.id = "bootstrapJS";
    script.src = url;
    return script;
  }

  document.head.appendChild(cssElement(GM_getResourceURL_("bootstrapCSS")));
  document.head.appendChild(jsElement(GM_getResourceURL_("bootstrapJS")));

  // overwrite bootstrap global box-sizing style
  const style = document.createElement("style");
  style.id = "LB_overwrite";
  style.innerHTML =
    "*,::after,::before { box-sizing: content-box; } .btn,.form-control,.form-select,.row>* { box-sizing: border-box; } body { background: initial; }";
  document.head.appendChild(style);
}

const bookmarkBatchSize = 100;
async function fetchBookmarks(uid, tagToQuery, offset, publicationType) {
  const bookmarksRaw = await fetch(
    `/ajax/user/${uid}` +
      `/illusts/bookmarks?tag=${tagToQuery}` +
      `&offset=${offset}&limit=${bookmarkBatchSize}&rest=${publicationType}`
  );
  if (!turboMode) await delay(500);
  const bookmarksRes = await bookmarksRaw.json();
  if (!bookmarksRaw.ok || bookmarksRes.error === true) {
    return alert(
      `获取用户收藏夹列表失败\nFail to fetch user bookmarks\n` +
        decodeURI(bookmarksRes.message)
    );
  } else return bookmarksRes.body;
}

async function fetchAllBookmarksByTag(
  tag,
  publicationType,
  progressBar,
  max = 100
) {
  let total = 65535,
    offset = 0,
    totalWorks = [];
  try {
    while (offset < total && window.runFlag) {
      if (turboMode) {
        const fetchPromises = [];
        const bookmarksBatch = [];
        const batchSize = 10;
        for (let i = 0; i < batchSize && offset < total; i++) {
          bookmarksBatch.push(
            fetchBookmarks(uid, tag, offset, publicationType)
          );
          offset += max;
        }
        const batchResults = await Promise.all(bookmarksBatch);
        for (const bookmarks of batchResults) {
          total = bookmarks.total;
          for (const work of bookmarks["works"]) {
            const fetchedWork = {
              ...work,
              associatedTags:
                bookmarks["bookmarkTags"][work["bookmarkData"]["id"]] || [],
            };
            totalWorks.push(fetchedWork);
            fetchPromises.push(fetchedWork);
          }
        }
        await Promise.all(fetchPromises);
        await delay(500);
      } else {
        const bookmarks = await fetchBookmarks(
          uid,
          tag,
          offset,
          publicationType
        );
        total = bookmarks.total;
        const works = bookmarks["works"];
        works.forEach(
          (w) =>
            (w.associatedTags =
              bookmarks["bookmarkTags"][w["bookmarkData"]["id"]] || [])
        );
        totalWorks.push(...works);
        offset = totalWorks.length;
      }
      if (progressBar) {
        progressBar.innerText = totalWorks.length + "/" + total;
        const ratio = ((totalWorks.length / total) * max).toFixed(2);
        progressBar.style.width = ratio + "%";
      }
    }
  } catch (err) {
    window.alert(
      `获取收藏夹时发生错误，请截图到GitHub反馈\nAn error was caught during fetching bookmarks. You might report it on GitHub${err.name}: ${err.message}\n${err.stack}`
    );
    console.log(err);
  } finally {
    if (progressBar) {
      progressBar.innerText = total + "/" + total;
      progressBar.style.width = "100%";
    }
  }
  return totalWorks;
}

async function addBookmark(illust_id, restrict, tags) {
  const resRaw = await fetch("/ajax/illusts/bookmarks/add", {
    headers: {
      accept: "application/json",
      "content-type": "application/json; charset=utf-8",
      "x-csrf-token": token,
    },
    body: JSON.stringify({
      illust_id,
      restrict,
      comment: "",
      tags,
    }),
    method: "POST",
  });
  await delay(500);
  return resRaw;
}

async function removeBookmark(bookmarkIds, progressBar) {
  async function run(ids) {
    await fetch("/ajax/illusts/bookmarks/remove", {
      headers: {
        accept: "application/json",
        "content-type": "application/json; charset=utf-8",
        "x-csrf-token": token,
      },
      body: JSON.stringify({ bookmarkIds: ids }),
      method: "POST",
    });
    await delay(500);
  }
  const num = Math.ceil(bookmarkIds.length / bookmarkBatchSize);
  for (let i of [...Array(num).keys()]) {
    if (!window.runFlag) break;
    const ids = bookmarkIds.filter(
      (_, j) => j >= i * bookmarkBatchSize && j < (i + 1) * bookmarkBatchSize
    );
    await run(ids);
    if (progressBar) {
      const offset = i * bookmarkBatchSize;
      progressBar.innerText = offset + "/" + bookmarkIds.length;
      const ratio = ((offset / bookmarkIds.length) * 100).toFixed(2);
      progressBar.style.width = ratio + "%";
    }
  }
  if (progressBar) {
    progressBar.innerText = bookmarkIds.length + "/" + bookmarkIds.length;
    progressBar.style.width = "100%";
  }
}

async function updateBookmarkTags(
  bookmarkIds,
  addTags,
  removeTags,
  progressBar
) {
  if (!bookmarkIds?.length)
    throw new TypeError("BookmarkIds is undefined or empty array");
  if (!Array.isArray(addTags) && !Array.isArray(removeTags))
    throw new TypeError("Either addTags or removeTags should be valid array");

  async function fetchRequest(url, data) {
    return await fetch(url, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json; charset=utf-8",
        "x-csrf-token": token,
      },
      body: JSON.stringify(data),
    });
  }
  async function run(ids) {
    if (turboMode) {
      const requests = [];
      if (addTags && addTags.length) {
        const addTagsChunks = chunkArray(addTags, bookmarkBatchSize);
        for (const tagsChunk of addTagsChunks) {
          requests.push(
            fetchRequest("/ajax/illusts/bookmarks/add_tags", {
              tags: tagsChunk,
              bookmarkIds: ids,
            })
          );
        }
      }
      if (removeTags && removeTags.length) {
        const removeTagsChunks = chunkArray(removeTags, bookmarkBatchSize);
        for (const tagsChunk of removeTagsChunks) {
          requests.push(
            fetchRequest("/ajax/illusts/bookmarks/remove_tags", {
              removeTags: tagsChunk,
              bookmarkIds: ids,
            })
          );
        }
      }
      if (requests.length > 1) await Promise.all(requests);
      await delay(500);
    } else {
      if (addTags && addTags.length) {
        await fetchRequest("/ajax/illusts/bookmarks/add_tags", {
          tags: addTags,
          bookmarkIds: ids,
        });
        await delay(500);
      }
      if (removeTags && removeTags.length) {
        await fetchRequest("/ajax/illusts/bookmarks/remove_tags", {
          removeTags,
          bookmarkIds: ids,
        });
        await delay(500);
      }
    }
  }

  let i = 0;
  for (const ids of chunkArray(bookmarkIds, bookmarkBatchSize)) {
    if (!window.runFlag) break;
    await run(ids);
    if (progressBar) {
      i++;
      const offset = Math.min(i * bookmarkBatchSize, bookmarkIds.length);
      progressBar.innerText = offset + "/" + bookmarkIds.length;
      const ratio = ((offset / bookmarkIds.length) * 100).toFixed(2);
      progressBar.style.width = ratio + "%";
    }
  }
  if (progressBar) {
    progressBar.innerText = bookmarkIds.length + "/" + bookmarkIds.length;
    progressBar.style.width = "100%";
  }
}

async function updateBookmarkRestrict(
  bookmarkIds,
  bookmarkRestrict,
  progressBar
) {
  if (!bookmarkIds?.length)
    throw new TypeError("BookmarkIds is undefined or empty array");
  if (!["public", "private"].includes(bookmarkRestrict))
    throw new TypeError("Bookmark restrict should be public or private");
  async function run(ids) {
    await fetch("/ajax/illusts/bookmarks/edit_restrict", {
      headers: {
        accept: "application/json",
        "content-type": "application/json; charset=utf-8",
        "x-csrf-token": token,
      },
      body: JSON.stringify({ bookmarkIds: ids, bookmarkRestrict }),
      method: "POST",
    });
    await delay(500);
  }
  const num = Math.ceil(bookmarkIds.length / bookmarkBatchSize);
  for (let i of [...Array(num).keys()]) {
    if (!window.runFlag) break;
    const ids = bookmarkIds.filter(
      (_, j) => j >= i * bookmarkBatchSize && j < (i + 1) * bookmarkBatchSize
    );
    await run(ids);
    if (progressBar) {
      const offset = i * bookmarkBatchSize;
      progressBar.innerText = offset + "/" + bookmarkIds.length;
      const ratio = ((offset / bookmarkIds.length) * 100).toFixed(2);
      progressBar.style.width = ratio + "%";
    }
  }
  if (progressBar) {
    progressBar.innerText = bookmarkIds.length + "/" + bookmarkIds.length;
    progressBar.style.width = "100%";
  }
}

async function clearBookmarkTags(works) {
  if (!works?.length) {
    return alert(
      `没有获取到收藏夹内容，操作中断，请检查选项下是否有作品\nFetching bookmark information failed. Abort operation. Please check the existence of works with the configuration`
    );
  }
  if (
    !window.confirm(
      `确定要删除所选作品的标签吗？（作品的收藏状态不会改变）\nThe tags of work(s) you've selected will be removed (become uncategorized). Is this okay?`
    )
  )
    return;
  window.runFlag = true;

  const modal = document.querySelector("#progress_modal");
  // noinspection TypeScriptUMDGlobal
  const bootstrap_ = bootstrap;
  let instance = bootstrap_.Modal.getInstance(modal);
  if (!instance) instance = new bootstrap_.Modal(modal);
  instance.show();

  const prompt = document.querySelector("#progress_modal_prompt");
  const progressBar = document.querySelector("#progress_modal_progress_bar");

  const tagPool = Array.from(
    new Set(works.reduce((a, b) => [...a, ...b.associatedTags], []))
  );
  const workLength = works.length;
  const tagPoolSize = tagPool.length;
  if (DEBUG) console.log(works, tagPool);

  if (workLength > tagPoolSize) {
    for (let index = 1; index <= tagPoolSize; index++) {
      if (!window.runFlag) break;
      const tag = tagPool[index - 1];
      const ids = works
        .filter((w) => w.associatedTags.includes(tag))
        .map((w) => w.bookmarkId || w["bookmarkData"]["id"]);
      if (DEBUG) console.log("Clearing", tag, ids);

      progressBar.innerText = index + "/" + tagPoolSize;
      const ratio = ((index / tagPoolSize) * 100).toFixed(2);
      progressBar.style.width = ratio + "%";
      prompt.innerText = `正在清除标签... / Clearing bookmark tags`;

      await updateBookmarkTags(ids, null, [tag]);
    }
  } else {
    for (let index = 1; index <= workLength; index++) {
      if (!window.runFlag) break;
      const work = works[index - 1];
      const url = "https://www.pixiv.net/artworks/" + work.id;
      console.log(index, work.title, work.id, url);
      if (DEBUG) console.log(work);

      progressBar.innerText = index + "/" + workLength;
      const ratio = ((index / workLength) * 100).toFixed(2);
      progressBar.style.width = ratio + "%";
      prompt.innerText = work.alt + "\n" + work.associatedTags.join(" ");

      await updateBookmarkTags(
        [work.bookmarkId || work["bookmarkData"]["id"]],
        undefined,
        work.associatedTags
      );
    }
  }

  if (window.runFlag) prompt.innerText = `标签删除完成！\nFinish Tag Clearing!`;
  else
    prompt.innerText =
      "检测到停止信号，程序已停止运行\nStop signal detected. Program exits.";
  setTimeout(() => {
    instance.hide();
    if (window.runFlag && !DEBUG) window.location.reload();
  }, 1000);
}

async function handleClearBookmarkTags(evt) {
  evt.preventDefault();
  const selected = [
    ...document.querySelectorAll("label>div[aria-disabled='true']"),
  ];
  if (!selected.length) return;

  const works = selected
    .map((el) => {
      const middleChild = Object.values(
        el.parentNode.parentNode.parentNode.parentNode
      )[0]["child"];
      const work = middleChild["memoizedProps"]["work"];
      work.associatedTags =
        middleChild["child"]["memoizedProps"]["associatedTags"] || [];
      work.bookmarkId = middleChild["memoizedProps"]["bookmarkId"];
      return work;
    })
    .filter((work) => work.associatedTags.length);
  await clearBookmarkTags(works);
}

async function deleteTag(tag, publicationType) {
  if (!tag)
    return alert(
      `请选择需要删除的标签\nPlease select the tag you would like to delete`
    );
  if (
    tag === "未分類" ||
    !window.confirm(
      `确定要删除所选的标签 ${tag} 吗？（作品的收藏状态不会改变）\nThe tag ${tag} will be removed and works of ${tag} will keep bookmarked. Is this okay?`
    )
  )
    return;
  window.runFlag = true;
  const modal = document.querySelector("#progress_modal");
  // noinspection TypeScriptUMDGlobal
  const bootstrap_ = bootstrap;
  let instance = bootstrap_.Modal.getInstance(modal);
  if (!instance) instance = new bootstrap_.Modal(modal);
  await instance.show();

  const prompt = document.querySelector("#progress_modal_prompt");
  const progressBar = document.querySelector("#progress_modal_progress_bar");

  const totalBookmarks = await fetchAllBookmarksByTag(
    tag,
    publicationType,
    progressBar,
    90
  );
  console.log(totalBookmarks);

  if (window.runFlag) {
    prompt.innerText = `标签${tag}删除中...\nDeleting Tag ${tag}`;
    progressBar.style.width = "90%";
  } else {
    prompt.innerText =
      "检测到停止信号，程序已停止运行\nStop signal detected. Program exits.";
    progressBar.style.width = "100%";
    return;
  }

  const ids = totalBookmarks.map((work) => work["bookmarkData"]["id"]);
  await updateBookmarkTags(ids, undefined, [tag]);

  progressBar.style.width = "100%";
  if (window.runFlag)
    prompt.innerText = `标签${tag}删除完成！\nTag ${tag} Removed!`;
  else
    prompt.innerText =
      "检测到停止信号，程序已停止运行\nStop signal detected. Program exits.";
  setTimeout(() => {
    instance.hide();
    if (window.runFlag && !DEBUG)
      window.location.href = `https://www.pixiv.net/users/${uid}/bookmarks/artworks?rest=${publicationType}`;
  }, 1000);
}

async function handleDeleteTag(evt) {
  evt.preventDefault();
  const { tag, restrict } = await updateWorkInfo();
  await deleteTag(tag, restrict ? "hide" : "show");
}

async function handleLabel(evt) {
  evt.preventDefault();

  const addFirst = document.querySelector("#label_add_first").value;
  const tagToQuery = document.querySelector("#label_tag_query").value;
  const publicationType = (await updateWorkInfo())["restrict"]
    ? "hide"
    : "show";
  const labelR18 = document.querySelector("#label_r18").value;
  const labelSafe = document.querySelector("#label_safe").value;
  const labelAI = document.querySelector("#label_ai").value;
  const labelAuthor = document.querySelector("#label_author").value;
  const labelStrict = document.querySelector("#label_strict").value;
  const exclusion = document
    .querySelector("#label_exclusion")
    .value.split(/[\s\n]/)
    .filter((t) => t);

  console.log("Label Configuration:");
  console.log(
    `addFirst: ${addFirst === "true"}; tagToQuery: ${tagToQuery}; labelR18: ${
      labelR18 === "true"
    }; labelSafe: ${labelSafe}; labelAI: ${labelAI}; publicationType: ${publicationType}; exclusion: ${exclusion.join(
      ","
    )}`
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
    offset = 0; // as uncategorized ones will decrease, offset means num of images updated "successfully"
  // update progress bar
  const progressBar = document.querySelector("#progress_bar");
  progressBar.style.width = "0";
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
      const url = "https://www.pixiv.net/artworks/" + work.id;
      if (DEBUG) console.log(index, work.title, work.id, url);
      index++;
      // ---- means unavailable, hidden or deleted by author
      if (work.title === "-----") {
        offset++;
        continue;
      }
      const workTags = work["tags"];
      if (labelAuthor) workTags.push(work["userName"], work["userId"]);
      let intersection = [...userTags, ...Object.keys(synonymDict)].filter(
        (userTag) => {
          // if work tags includes this user tag
          if (
            arrayIncludes(workTags, userTag) || // full tag
            arrayIncludes(workTags, userTag, getWorkTitle) || // work title
            (arrayIncludes(workTags, userTag, null, getCharacterName) && // char name
              (!labelStrict ||
                arrayIncludes(workTags, userTag, null, getWorkTitle))) // not strict or includes work title
          )
            return true;
          // if work tags match a user alias (exact match)
          return (
            synonymDict[userTag] &&
            synonymDict[userTag].find(
              (alias) =>
                arrayIncludes(workTags, alias) ||
                arrayIncludes(workTags, alias, getWorkTitle) || // work title
                (arrayIncludes(workTags, alias, null, getCharacterName) &&
                  (!labelStrict ||
                    arrayIncludes(workTags, alias, null, getWorkTitle)))
            )
          );
        }
      );
      // if workTags match some alias, add it to the intersection (exact match, with or without work title)
      intersection = intersection.concat(
        Object.keys(synonymDict).filter((aliasName) => {
          if (!synonymDict[aliasName]) {
            console.log(aliasName, synonymDict[aliasName]);
            throw new Error("Empty value in synonym dictionary");
          }
          if (
            workTags.some(
              (workTag) =>
                arrayIncludes(
                  synonymDict[aliasName].concat(aliasName),
                  workTag,
                  null,
                  getWorkTitle
                ) ||
                arrayIncludes(
                  synonymDict[aliasName].concat(aliasName),
                  workTag,
                  null,
                  getCharacterName
                )
            )
          )
            return true;
        })
      );
      if (work["xRestrict"] && labelR18 === "true") intersection.push("R-18");
      if (!work["xRestrict"] && labelSafe === "true") intersection.push("SFW");
      if (work["aiType"] === 2 && labelAI === "true") intersection.push("AI");
      // remove duplicate and exclusion
      intersection = Array.from(new Set(intersection)).filter(
        (t) => !exclusion.includes(t)
      );

      const bookmarkId = work["bookmarkData"]["id"];
      const prevTags = bookmarks["bookmarkTags"][bookmarkId] || [];

      if (!intersection.length && !prevTags.length) {
        if (addFirst === "true") {
          const first = workTags
            .filter(
              (tag) =>
                !exclusion.includes(tag) &&
                tag.length <= 20 &&
                !tag.includes("入り")
            )
            .slice(0, 1); // Can be changed if you want to add more than 1 tag from the same work
          if (first) {
            intersection.push(...first);
            userTags.push(...first);
          }
        }
      }

      const addTags = intersection.filter((tag) => !prevTags.includes(tag));

      // for uncategorized
      if (!intersection.length) {
        offset++;
      }
      if (addTags.length) {
        if (!DEBUG) console.log(index, work.title, work.id, url);
        console.log("\tprevTags:", prevTags);
        console.log("\tintersection:", intersection);
        console.log("\taddTags:", addTags);
      } else continue;

      promptBottom.innerText = `处理中，请勿关闭窗口 / Processing. Please do not close the window.\n${work.alt}`;
      await updateBookmarkTags([bookmarkId], addTags);

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
  } else if (window.runFlag) {
    promptBottom.innerText = `自动添加标签已完成，请关闭窗口并刷新网页
  Auto labeling finished successfully. Please close the window and refresh.
  `;
  }
  window.runFlag = false;
}

let prevSearch, searchBatch, searchResults, searchOffset, totalBookmarks;
async function handleSearch(evt) {
  evt.preventDefault();

  let searchMode = 0;
  let searchString = document.querySelector("#search_value")?.value;
  if (
    document.querySelector("#basic_search_field").className.includes("d-none")
  ) {
    searchMode = 1;
    searchString = [...document.querySelectorAll(".advanced_search_field")]
      .map((el) => el.value.split(" ")[0])
      .join(" ");
  }
  searchString = searchString.replace(/！/g, "!").trim();
  const searchStringArray = searchString.split(" ");
  let searchConfigs = Array(searchStringArray.length).fill(Array(4).fill(true));
  if (searchMode) {
    const advanced = document.querySelector("#advanced_search_fields");
    const configContainers = [...advanced.querySelectorAll(".row")];
    searchConfigs = configContainers.map((el) =>
      [...el.querySelectorAll("input")].map((i) => i.checked)
    );
  }

  const matchPattern = document.querySelector("#search_exact_match").value;
  const tagsLengthMatch =
    document.querySelector("#search_length_match").value === "true";
  const tagToQuery = document.querySelector("#search_select_tag").value;
  const publicationType = document.querySelector("#search_publication").value;
  const newSearch = {
    searchString,
    searchConfigs,
    matchPattern,
    tagsLengthMatch,
    tagToQuery,
    publicationType,
  };

  // initialize new search
  window.runFlag = true;
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
    clearTimeout(timeout);
    document.querySelector("#search_suggestion").parentElement.style.display =
      "none";
  } else {
    searchBatch += 200;
  }

  if (searchOffset && searchOffset === totalBookmarks) {
    window.runFlag = false;
    return alert(`
    已经完成所选标签下所有收藏的搜索！
    All Bookmarks Of Selected Tag Have Been Searched!
    `);
  }
  const spinner = document.querySelector("#spinner");
  spinner.style.display = "block";

  // noinspection TypeScriptUMDGlobal
  const bootstrap_ = bootstrap;
  const collapseIns = bootstrap_.Collapse.getInstance(
    document.querySelector("#advanced_search")
  );
  if (collapseIns) collapseIns.hide();

  let includeArray = searchStringArray.filter(
    (el) => el.length && !el.includes("!")
  );
  let excludeArray = searchStringArray
    .filter((el) => el.length && el.includes("!"))
    .map((el) => el.slice(1));

  console.log("Search Configuration:", searchConfigs);
  console.log(
    `matchPattern: ${matchPattern}; tagsLengthMatch: ${tagsLengthMatch}; tagToQuery: ${tagToQuery}; publicationType: ${publicationType}`
  );
  console.log("includeArray:", includeArray, "excludeArray", excludeArray);

  const textColor = theme ? "rgba(0, 0, 0, 0.88)" : "rgba(255, 255, 255, 0.88)";

  const searchPrompt = document.querySelector("#search_prompt");
  let index = 0; // index for current search batch
  do {
    const bookmarks = await fetchBookmarks(
      uid,
      tagToQuery,
      searchOffset,
      publicationType
    );
    searchPrompt.innerText = `
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
      const bookmarkTags =
        bookmarks["bookmarkTags"][work["bookmarkData"]["id"]] || []; // empty if uncategorized
      work.bookmarkTags = bookmarkTags;
      const workTags = work["tags"];

      const ifInclude = (keyword) => {
        // especially, R-18 tag is labelled in work
        if (["R-18", "r-18", "R18", "r18"].includes(keyword))
          return work["xRestrict"];

        const index = searchStringArray.findIndex((kw) => kw.includes(keyword));
        const config = searchConfigs[index];
        if (DEBUG) console.log(keyword, config);

        // convert input keyword to a user tag
        // keywords from user input, alias from dict
        // keyword: 新世纪福音战士
        // alias: EVA eva
        const el = Object.keys(synonymDict)
          .map((key) => [key.split("(")[0], key]) // [char name, full key]
          .find(
            (el) =>
              stringIncludes(el[0], keyword) || // input match char name
              stringIncludes(el[1], keyword) || // input match full name
              arrayIncludes(synonymDict[el[1]], keyword) || // input match any alias
              (matchPattern === "fuzzy" &&
                (stringIncludes(el[1], keyword) ||
                  arrayIncludes(synonymDict[el[1]], keyword, null, null, true)))
          );
        const keywordArray = [keyword];
        if (el) {
          keywordArray.push(...el);
          keywordArray.push(...synonymDict[el[1]]);
        }
        if (
          keywordArray.some(
            (kw) =>
              (config[0] && stringIncludes(work.title, kw)) ||
              (config[1] && stringIncludes(work["userName"], kw)) ||
              (config[2] && arrayIncludes(workTags, kw)) ||
              (config[3] && arrayIncludes(bookmarkTags, kw))
          )
        )
          return true;
        if (matchPattern === "exact") return false;
        return keywordArray.some(
          (kw) =>
            (config[2] && arrayIncludes(workTags, kw, null, null, true)) ||
            (config[3] && arrayIncludes(bookmarkTags, kw, null, null, true))
        );
      };

      if (
        (!tagsLengthMatch || includeArray.length === bookmarkTags.length) &&
        includeArray.every(ifInclude) &&
        !excludeArray.some(ifInclude)
      ) {
        searchResults.push(work);
        displayWork(work, resultsDiv, textColor);
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
      <div class="text-center text-black-50 fw-bold py-4 ${textColor}" style="white-space: pre-wrap; font-size: 2rem" id="no_result">
        暂无结果 / No Result
      </div>
    `;
  }
  spinner.style.display = "none";
  console.log(searchResults);
  window.runFlag = false;
}

function displayWork(work, resultsDiv, textColor) {
  const tagsString = work.tags
    .slice(0, 6)
    .map((i) => "#" + i)
    .join(" ");
  const container = document.createElement("div");
  const profile =
    work["profileImageUrl"] ||
    "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";
  container.className = "col-4 col-lg-3 col-xl-2 p-1";
  container.innerHTML = `
       <div class="mb-1 position-relative">
         <img src=${work.url} alt="square" class="rounded-3 img-fluid" />
         <div class="position-absolute w-100" style="pointer-events: none; top: 0;">
           <div class="p-1 d-flex">
             <div class="rate-icon d-none">R-18</div>
             <div class="ms-auto page-icon d-none">
               <span class="gbNjFx">
                 <svg viewBox="0 0 9 10" width="9" height="9" class="sc-14heosd-1 fArvVr">
                   <path d="M8,3 C8.55228475,3 9,3.44771525 9,4 L9,9 C9,9.55228475 8.55228475,10 8,10 L3,10 C2.44771525,10 2,9.55228475 2,9 L6,9 C7.1045695,9 8,8.1045695 8,7 L8,3 Z M1,1 L6,1    C6.55228475,1 7,1.44771525 7,2 L7,7 C7,7.55228475 6.55228475,8 6,8 L1,8 C0.44771525,8    0,7.55228475 0,7 L0,2 C0,1.44771525 0.44771525,1 1,1 Z" transform=""></path>
                 </svg>
               </span>
               <span class="ms-1 page-count">${work["pageCount"]}</span>
             </div>
           </div>
         </div>
       </div>
       <div class="mb-1" style="font-size: 10px; color: rgb(61, 118, 153); pointer-events: none">
         ${tagsString}
       </div>
       <div class="mb-1">
         <a href=${"/artworks/" + work.id}
          target="_blank" rel="noreferrer"
          style="font-weight: bold; color: ${textColor};">
          ${work.title}
          </a>
       </div>
       <div class="mb-4">
        <a href=${"/users/" + work["userId"]}  target="_blank" rel="noreferrer"
          style="rgba(0, 0, 0, 0.64)">
          <img
            src=${profile} alt="profile" class="rounded-circle"
            style="width: 24px; height: 24px; margin-right: 4px"
          />
          ${work["userName"]}
        </a>
       </div>
      `;
  if (work["xRestrict"])
    container.querySelector(".rate-icon").classList.remove("d-none");
  if (work["pageCount"] > 1)
    container.querySelector(".page-icon").classList.remove("d-none");
  container.firstElementChild.addEventListener("click", (evt) =>
    galleryMode(evt, work)
  );
  resultsDiv.appendChild(container);
}

function galleryMode(evt, work) {
  if (DEBUG) console.log(work);
  const modal = evt.composedPath().find((el) => el.id.includes("modal"));
  const scrollTop = modal.scrollTop;
  const dialog = evt
    .composedPath()
    .find((el) => el.className.includes("modal-dialog"));
  dialog.classList.add("modal-fullscreen");
  const title = dialog.querySelector(".modal-header");
  const body = dialog.querySelector(".modal-body");
  const footer = dialog.querySelector(".modal-footer");
  const gallery = modal.querySelector(".gallery");
  const works = modal.id === "search_modal" ? searchResults : generatedResults;
  let index = works.findIndex((w) => w === work);
  const host = "https://i.pximg.net/img-master";
  gallery.innerHTML = `
    <div class="p-2">
      <div class="images my-2" style="min-height: calc(100vh - 4.5rem);"></div>
      <button class="btn btn-outline-secondary w-100 d-none" id="gallery_all">查看全部 / See All</button>
      <button class="btn p-0 opacity-50 position-fixed" style="left: 2rem; top: 2rem;" id="gallery_exit">
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" fill="currentColor" class="bi bi-x-lg" viewBox="0 0 16 16">
          <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8 2.146 2.854Z"/>
        </svg>
      </button>
      <a class="position-fixed" style="left: 2rem; top: 7rem;" target="_blank" rel="noreferrer" id="gallery_link">
        <button class="btn p-0 opacity-50">
          <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" fill="currentColor" class="bi bi-arrow-up-right" viewBox="0 0 16 16">
            <path fill-rule="evenodd" d="M14 2.5a.5.5 0 0 0-.5-.5h-6a.5.5 0 0 0 0 1h4.793L2.146 13.146a.5.5 0 0 0 .708.708L13 3.707V8.5a.5.5 0 0 0 1 0v-6z"/>
          </svg>
        </button>
      </a>
      <button class="btn p-0 opacity-50 position-fixed" style="left: 2rem; top: 50vh; transform: translateY(-50%);" id="gallery_left">
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" fill="currentColor" class="bi bi-chevron-double-left" viewBox="0 0 16 16">
          <path fill-rule="evenodd" d="M8.354 1.646a.5.5 0 0 1 0 .708L2.707 8l5.647 5.646a.5.5 0 0 1-.708.708l-6-6a.5.5 0 0 1 0-.708l6-6a.5.5 0 0 1 .708 0z"/>
          <path fill-rule="evenodd" d="M12.354 1.646a.5.5 0 0 1 0 .708L6.707 8l5.647 5.646a.5.5 0 0 1-.708.708l-6-6a.5.5 0 0 1 0-.708l6-6a.5.5 0 0 1 .708 0z"/>
        </svg>
      </button>
      <button class="btn p-0 opacity-50 position-fixed" style="right: 2rem; top: 50vh; transform: translateY(-50%);" id="gallery_right">
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" fill="currentColor" class="bi bi-chevron-double-right" viewBox="0 0 16 16">
          <path fill-rule="evenodd" d="M3.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L9.293 8 3.646 2.354a.5.5 0 0 1 0-.708z"/>
          <path fill-rule="evenodd" d="M7.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L13.293 8 7.646 2.354a.5.5 0 0 1 0-.708z"/>
        </svg>
      </button>
    </div>
  `;
  const imageContainer = gallery.querySelector(".images");
  const all = gallery.querySelector("#gallery_all");

  let pageIndex = 0,
    pageLoaded = false,
    masterUrl;
  function updateWork(work) {
    masterUrl = work.url.includes("limit_unknown")
      ? work.url
      : host +
        work.url
          .match(/\/img\/.*/)[0]
          .replace(/_(custom|square)1200/, "_master1200");
    imageContainer.innerHTML = `
      <div class="text-center">
        <img class="gallery-image mb-2" src=${masterUrl} alt="master">
      </div>
    `;
    gallery.querySelector("#gallery_link").href = "/artworks/" + work.id;
    pageIndex = 0;
    pageLoaded = false;
    if (work["pageCount"] > 1) all.classList.remove("d-none");
    else all.classList.add("d-none");
  }
  updateWork(work);

  function loadAll() {
    const work = works[index];
    [...Array(work["pageCount"] - 1).keys()].forEach((i) => {
      const p = i + 1;
      const url = masterUrl.replace("_p0_", `_p${p}_`);
      const div = document.createElement("div");
      div.className = "text-center";
      div.innerHTML = `<img class="gallery-image mb-2" src=${url} alt="page${p}">`;
      imageContainer.appendChild(div);
    });
    all.classList.add("d-none");
    pageLoaded = true;
  }
  all.addEventListener("click", loadAll);

  gallery.querySelector("#gallery_exit").addEventListener("click", () => {
    dialog.classList.remove("modal-fullscreen");
    gallery.classList.add("d-none");
    title.classList.remove("d-none");
    body.classList.remove("d-none");
    footer.classList.remove("d-none");
    modal.removeEventListener("keyup", fnKey);
    modal.scrollTo({ top: scrollTop, behavior: "smooth" });
  });

  function preFetch(work) {
    const url = work.url.includes("limit_unknown")
      ? work.url
      : host +
        work.url
          .match(/\/img\/.*/)[0]
          .replace(/_(custom|square)1200/, "_master1200");
    const img = new Image();
    img.src = url;
  }
  function prev() {
    if (works[index - 1]) {
      index--;
      updateWork(works[index]);
      if (works[index - 1]) preFetch(works[index - 1]);
    }
  }
  function next() {
    if (works[index + 1]) {
      index++;
      updateWork(works[index]);
      if (works[index + 1]) preFetch(works[index + 1]);
    }
  }
  function up() {
    if (!pageLoaded) return;
    const scrollY = gallery.scrollTop;
    pageIndex = Math.max(0, pageIndex - 1);
    const elemTop =
      imageContainer.children[pageIndex].getBoundingClientRect().top;
    gallery.scrollTo({ top: scrollY + elemTop });
  }
  function down() {
    if (!pageLoaded) return loadAll();
    const scrollY = gallery.scrollTop;
    pageIndex = Math.min(pageIndex + 1, works[index]["pageCount"] - 1);
    const elemTop =
      imageContainer.children[pageIndex].getBoundingClientRect().top;
    gallery.scrollTo({ top: scrollY + elemTop });
  }
  function fnKey(evt) {
    if (evt.key === "ArrowLeft") prev();
    else if (evt.key === "ArrowRight") next();
    else if (evt.key === "ArrowUp") up();
    else if (evt.key === "ArrowDown") down();
  }
  gallery.querySelector("#gallery_left").addEventListener("click", prev);
  gallery.querySelector("#gallery_right").addEventListener("click", next);
  modal.addEventListener("keyup", fnKey);

  gallery.classList.remove("d-none");
  title.classList.add("d-none");
  body.classList.add("d-none");
  footer.classList.add("d-none");
}

let prevTag,
  prevRestriction,
  totalAvailable,
  generatorBookmarks,
  generatedResults,
  generatorDisplayLimit,
  generatorBatchNum;
async function handleGenerate(evt) {
  evt.preventDefault();
  const tag = document.querySelector("#generator_select_tag").value;
  const batchSize = Math.max(
    0,
    parseInt(document.querySelector("#generator_form_num").value) || 100
  );
  const publicationType = document.querySelector(
    "#generator_form_publication"
  ).value;
  const restriction = document.querySelector(
    "#generator_form_restriction"
  ).value;
  console.log(tag, batchSize, publicationType, restriction);
  if (
    !tag &&
    !confirm(
      `加载全部收藏夹需要较长时间，是否确认操作？\nLoad the whole bookmark will take quite long time to process. Is this okay?`
    )
  )
    return;

  const resultsDiv = document.querySelector("#generator_results");
  while (resultsDiv.firstChild) {
    resultsDiv.removeChild(resultsDiv.firstChild);
  }

  const display = document.querySelector("#generator_display");
  display.classList.remove("d-none");
  const prompt = document.querySelector("#generator_save_tag_prompt");
  if (prevTag !== tag || !generatorBookmarks?.length) {
    prevTag = tag;
    prevRestriction = null;
    generatorDisplayLimit = 12;
    generatorBookmarks = [];
    generatorBatchNum = -1;
    let offset = 0,
      total = 0;
    window.runFlag = true;
    prompt.classList.remove("d-none");
    prompt.innerText =
      "正在加载收藏夹信息，点击停止可中断运行 / Loading bookmarks, Click stop to abort";
    do {
      if (!window.runFlag) break;
      const bookmarks = await fetchBookmarks(uid, tag, offset, publicationType);
      if (!total) {
        total = bookmarks.total;
        prompt.innerText = `正在加载收藏夹信息（${total}），点击停止可中断运行 / Loading bookmarks (${total}), Click stop to abort`;
      }
      generatorBookmarks.push(...bookmarks["works"]);
      offset = generatorBookmarks.length;
    } while (offset < total);
    prompt.classList.add("d-none");
    window.runFlag = false;
    shuffle(generatorBookmarks);
  }
  if (prevRestriction !== restriction) {
    prevRestriction = restriction;
    generatorBatchNum = -1;
    if (restriction !== "all") {
      generatorBookmarks.forEach((w) => {
        w.used = !!(
          (restriction === "sfw" && w["xRestrict"]) ||
          (restriction === "nsfw" && !w["xRestrict"])
        );
      });
    }
    totalAvailable = generatorBookmarks.filter((w) => !w.used).length;
    document.querySelector("#generator_spinner").classList.add("d-none");
    console.log(generatorBookmarks);
  }
  if (!totalAvailable) {
    display.classList.add("d-none");
    prompt.innerText = "图片加载失败 / Image Loading Failed";
    return;
  }
  document.querySelector("#generator_form_buttons").classList.remove("d-none");

  let availableBookmarks = generatorBookmarks.filter((w) => !w.used);
  if (generatorBookmarks.length && !availableBookmarks.length) {
    generatorBatchNum = -1;
    generatorBookmarks.forEach((w) => {
      if (
        restriction === "all" ||
        (restriction === "sfw" && !w["xRestrict"]) ||
        (restriction === "nsfw" && w["xRestrict"])
      )
        w.used = false;
    });
    availableBookmarks = generatorBookmarks.filter((w) => !w.used);
  }
  generatorBatchNum++;

  const textColor = theme ? "rgba(0, 0, 0, 0.88)" : "rgba(255, 255, 255, 0.88)";
  generatedResults = availableBookmarks.slice(0, batchSize);
  generatedResults.forEach((w) => (w.used = true));
  generatedResults
    .filter((_, i) => i < generatorDisplayLimit)
    .forEach((w) => displayWork(w, resultsDiv, textColor));
  if (generatedResults.length > generatorDisplayLimit) {
    document.querySelector("#generator_more").classList.remove("d-none");
  }
  document.querySelector(
    "#generator_prompt"
  ).innerText = `当前批次 / Batch Num: ${generatorBatchNum} | 当前展示 / Display: ${generatedResults.length} / ${totalAvailable}`;
}

function shuffle(array) {
  let currentIndex = array.length,
    randomIndex;
  // while there remain elements to shuffle.
  while (currentIndex !== 0) {
    // pick a remaining element.
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;
    // swap it with the current element.
    [array[currentIndex], array[randomIndex]] = [
      array[randomIndex],
      array[currentIndex],
    ];
  }
  return array;
}

const hold = false;
function createModalElements() {
  // noinspection TypeScriptUMDGlobal
  const bootstrap_ = bootstrap;
  const bgColor = theme ? "bg-white" : "bg-dark";
  const textColor = theme ? "text-lp-dark" : "text-lp-light";
  addStyle(`
  .text-lp-dark {
    color: rgb(31, 31, 31);
  }
  .text-lp-light {
    color: rgb(245, 245, 245);
  }
  .label-button.text-lp-dark, .label-button.text-lp-light {
    color: rgb(133, 133, 133);
  }
  .label-button.text-lp-dark:hover {
    color: rgb(31, 31, 31);
  }
  .label-button.text-lp-light:hover {
    color: rgb(245, 245, 245);
  }
  .icon-invert {
    filter: invert(1);
  }
  .bg-dark button, .form-control, .form-control:focus, .form-select {
    color: inherit;
    background: inherit;
  }
  .modal::-webkit-scrollbar, .no-scroll::-webkit-scrollbar {
    display: none; /* Chrome */
  }
  .modal, .no-scroll {
    -ms-overflow-style: none;  /* IE and Edge */
    scrollbar-width: none;  /* Firefox */
  }
  .btn-close-empty {
    background: none;
    height: initial;
    width: initial;
  }
  .gallery-image {
    max-height: calc(100vh - 5rem);
  }
  .rate-icon {
    padding: 0px 6px;
    border-radius: 3px;
    color: rgb(245, 245, 245);
    background: rgb(255, 64, 96);
    font-weight: bold;
    font-size: 10px;
    line-height: 16px;
    user-select: none;
    height: 16px;
  }
  .page-icon {
    display: flex;
    -webkit-box-pack: center;
    justify-content: center;
    -webkit-box-align: center;
    align-items: center;
    flex: 0 0 auto;
    box-sizing: border-box;
    height: 20px;
    min-width: 20px;
    color: rgb(245, 245, 245);
    font-weight: bold;
    padding: 0px 6px;
    background: rgba(0, 0, 0, 0.32);
    border-radius: 10px;
    font-size: 10px;
    line-height: 10px;
  }
  .page-icon:first-child {
    display: inline-flex;
    vertical-align: top;
    -webkit-box-align: center;
    align-items: center;
    height: 10px;
  }
  #gallery_link:hover {
    color: var(--bs-btn-hover-color);
  }
  `);
  const backdropConfig = getValue("backdropConfig", "false") === "true";
  const svgPin = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-pin" viewBox="0 0 16 16">
    <path d="M4.146.146A.5.5 0 0 1 4.5 0h7a.5.5 0 0 1 .5.5c0 .68-.342 1.174-.646 1.479-.126.125-.25.224-.354.298v4.431l.078.048c.203.127.476.314.751.555C12.36 7.775 13 8.527 13 9.5a.5.5 0 0 1-.5.5h-4v4.5c0 .276-.224 1.5-.5 1.5s-.5-1.224-.5-1.5V10h-4a.5.5 0 0 1-.5-.5c0-.973.64-1.725 1.17-2.189A5.921 5.921 0 0 1 5 6.708V2.277a2.77 2.77 0 0 1-.354-.298C4.342 1.674 4 1.179 4 .5a.5.5 0 0 1 .146-.354zm1.58 1.408-.002-.001.002.001zm-.002-.001.002.001A.5.5 0 0 1 6 2v5a.5.5 0 0 1-.276.447h-.002l-.012.007-.054.03a4.922 4.922 0 0 0-.827.58c-.318.278-.585.596-.725.936h7.792c-.14-.34-.407-.658-.725-.936a4.915 4.915 0 0 0-.881-.61l-.012-.006h-.002A.5.5 0 0 1 10 7V2a.5.5 0 0 1 .295-.458 1.775 1.775 0 0 0 .351-.271c.08-.08.155-.17.214-.271H5.14c.06.1.133.191.214.271a1.78 1.78 0 0 0 .37.282z"/>
  </svg>`;
  const svgUnpin = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-pin-angle" viewBox="0 0 16 16">
    <path id="svg_unpin" d="M9.828.722a.5.5 0 0 1 .354.146l4.95 4.95a.5.5 0 0 1 0 .707c-.48.48-1.072.588-1.503.588-.177 0-.335-.018-.46-.039l-3.134 3.134a5.927 5.927 0 0 1 .16 1.013c.046.702-.032 1.687-.72 2.375a.5.5 0 0 1-.707 0l-2.829-2.828-3.182 3.182c-.195.195-1.219.902-1.414.707-.195-.195.512-1.22.707-1.414l3.182-3.182-2.828-2.829a.5.5 0 0 1 0-.707c.688-.688 1.673-.767 2.375-.72a5.922 5.922 0 0 1 1.013.16l3.134-3.133a2.772 2.772 0 0 1-.04-.461c0-.43.108-1.022.589-1.503a.5.5 0 0 1 .353-.146zm.122 2.112v-.002.002zm0-.002v.002a.5.5 0 0 1-.122.51L6.293 6.878a.5.5 0 0 1-.511.12H5.78l-.014-.004a4.507 4.507 0 0 0-.288-.076 4.922 4.922 0 0 0-.765-.116c-.422-.028-.836.008-1.175.15l5.51 5.509c.141-.34.177-.753.149-1.175a4.924 4.924 0 0 0-.192-1.054l-.004-.013v-.001a.5.5 0 0 1 .12-.512l3.536-3.535a.5.5 0 0 1 .532-.115l.096.022c.087.017.208.034.344.034.114 0 .23-.011.343-.04L9.927 2.028c-.029.113-.04.23-.04.343a1.779 1.779 0 0 0 .062.46z"/>
  </svg>`;
  const svgClose = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-x-lg" viewBox="0 0 16 16">
  <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8 2.146 2.854Z"/>
</svg>`;
  const defaultPinConfig = backdropConfig ? svgPin : svgUnpin;

  const showLatest = getValue("version") !== version ? "show" : "";

  const lastBackupDictTime = getValue("lastBackupDict", "");
  let lastBackupDict = "";
  if (lastBackupDictTime) {
    if (lang.includes("zh")) {
      lastBackupDict = `<div style="font-size: 0.75rem; opacity: 0.4">最后备份：${new Date(
        parseInt(lastBackupDictTime)
      ).toLocaleDateString("zh-CN")}</div>`;
    } else {
      lastBackupDict = `<div style="font-size: 0.75rem; opacity: 0.4">Last Backup: ${new Date(
        parseInt(lastBackupDictTime)
      ).toLocaleDateString("en-US")}</div>`;
    }
  }

  // label
  const labelModal = document.createElement("div");
  labelModal.className = "modal fade";
  labelModal.id = "label_modal";
  labelModal.tabIndex = -1;
  labelModal.innerHTML = `
    <div class="modal-dialog modal-lg ${bgColor} ${textColor}" style="pointer-events: initial">
      <div class="modal-header">
        <h5 class="modal-title">自动添加标签 / Label Bookmarks</h5>
        <button class="btn btn-close btn-close-empty ms-auto" id="label_pin">${defaultPinConfig}</button>
        <button class="btn btn-close btn-close-empty ms-3" data-bs-dismiss="modal">${svgClose}</button>
      </div>
      <form class="modal-body p-4" id="label_form">
        <div class="mb-4 mt-2">
          <button type="button" class="mb-3 btn p-0" data-bs-toggle="collapse" data-bs-target="#latest_content" id="toggle_latest">
            &#9658; 最近更新 / Latest
          </button>
          <div class="px-3 fw-light collapse ${showLatest}" id="latest_content">
            <div class="mb-3">
              <div>如果对以下配置有疑惑，请参考<a href="https://greasyfork.org/zh-CN/scripts/423823-pixiv%E6%94%B6%E8%97%8F%E5%A4%B9%E8%87%AA%E5%8A%A8%E6%A0%87%E7%AD%BE?locale_override=1" style="text-decoration: underline"
                  target="_blank" rel="noreferrer">文档</a>
              </div>
              <div>Please refer to the
                <a href="https://greasyfork.org/en/scripts/423823-pixiv%E6%94%B6%E8%97%8F%E5%A4%B9%E8%87%AA%E5%8A%A8%E6%A0%87%E7%AD%BE" style="text-decoration: underline"
                  target="_blank" rel="noreferrer">document</a> if confused.
              </div>
            </div>
            <div style="white-space: pre">${latest}</div>
          </div>
        </div>
        <div class="mb-4">
          <button type="button" class="mb-3 btn p-0" data-bs-toggle="collapse" data-bs-target="#synonym_content">
            &#9658; 同义词词典 / Synonym Dict
          </button>
          <div class="collapse show px-3" id="synonym_content">
            <div class="mb-4">
              <button type="button" class="btn p-0 fw-light" data-bs-toggle="collapse"
                data-bs-target="#load_synonym_dict">&#9658; 加载词典 / Load Dict</button>
              <div class="pt-3 collapse" id="load_synonym_dict">
                <input class="form-control border mb-3" type="file" accept="application/json" id="synonym_dict_input"/>
                <div class="mb-3 d-flex">
                  <div class="fw-light me-auto">
                    如果词典意外丢失，请点击右侧按钮获取历史版本的词典用于恢复，并上报该BUG
                    <br />
                    If the dictionary accidentally got lost, click the right button to download the history version for restoring, as well as reporting the bug ASAP.
                  </div>
                  <button type="button" class="btn btn-outline-primary ms-3" id="label_restore_dict">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-arrow-counterclockwise" viewBox="0 0 16 16">
                      <path fill-rule="evenodd" d="M8 3a5 5 0 1 1-4.546 2.914.5.5 0 0 0-.908-.417A6 6 0 1 0 8 2v1z"/>
                      <path d="M8 4.466V.534a.25.25 0 0 0-.41-.192L5.23 2.308a.25.25 0 0 0 0 .384l2.36 1.966A.25.25 0 0 0 8 4.466z"/>
                    </svg>
                  </button>
                </div>
                <div class="mb-3 d-flex">
                  <div class="fw-light me-auto">
                    点击右侧可以下载样例词典用于导入
                    <br />
                    Click the right button to get a synonym dictionary sample for loading
                  </div>
                  <button type="button" class="btn btn-outline-primary ms-3" id="label_dict_sample">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-arrow-down" viewBox="0 0 16 16">
                      <path fill-rule="evenodd" d="M8 1a.5.5 0 0 1 .5.5v11.793l3.146-3.147a.5.5 0 0 1 .708.708l-4 4a.5.5 0 0 1-.708 0l-4-4a.5.5 0 0 1 .708-.708L7.5 13.293V1.5A.5.5 0 0 1 8 1z"/>
                    </svg>
                  </button>
                </div>
              </div>
            </div>
            <div class="mb-4">
              <button type="button" class="btn p-0 fw-light" data-bs-toggle="collapse"
                data-bs-target="#edit_synonym_dict">&#9658; 编辑词典 / Edit Dict</button>
              <div class="pt-3 collapse" id="edit_synonym_dict">
                <label class="form-label fw-light" for="target_tag">目标标签（用户标签） / Target Tag (User Tag)</label>
                <input class="form-control mb-3" type="text" id="target_tag" placeholder="eg: 新世紀エヴァンゲリオン" />
                <label class="form-label fw-light" for="tag_alias">同义词（作品标签，空格/回车分割，不区分大小写） / Alias (From Artwork, Space/Line Delimited, Case-Insensitive)</label>
                <textarea class="form-control mb-3" rows="2" id="tag_alias" style="min-height: initial" placeholder="eg: エヴァンゲリオン evangelion eva"></textarea>
                <div class="mb-3" style="display: none" >
                  <div class="mb-2">备选同义词 / Suggested Alias</div>
                  <div class="ms-3" id="label_suggestion"></div>
                </div>
                <div class="d-flex mb-2" id="synonym_buttons">
                  <button type="button" class="btn btn-outline-primary me-auto" title="保存至本地\nSave to Local Disk">导出词典 / Export Dict</button>
                  <button type="button" class="btn btn-outline-primary me-3" title="加载已有标签的同义词\nLoad Alias of Existing User Tag">加载标签 / Load Tag</button>
                  <button type="button" class="btn btn-outline-primary" title="保存结果至词典，同义词为空时将删除该项\nUpdate dict. User tag will be removed if alias is empty">更新标签 / Update Tag</button>
                </div>
                ${lastBackupDict}
              </div>
            </div>
            <div class="mb-4">
              <button type="button" class="btn p-0 fw-light" data-bs-toggle="collapse"
                data-bs-target="#preview_synonym_dict">&#9658; 预览词典 / Preview Dict</button>
              <div class="pt-3 collapse show" id="preview_synonym_dict">
                <div class="mb-2 position-relative">
                  <input type="text" class="form-control mb-2" id="synonym_filter" placeholder="筛选 / Filter" />
                  <button type="button" class="position-absolute btn btn-close end-0 top-50 translate-middle" id="clear_synonym_filter"/>
                </div>
                <div id="synonym_preview" class="border py-1 px-3 no-scroll" style="white-space: pre-wrap; min-height: 100px; max-height: 32vh; overflow-y: scroll"></div>
              </div>
            </div>
          </div>
        </div>
        <div class="mb-4">
          <button type="button" class="btn p-0 mb-3" data-bs-toggle="collapse" data-bs-target="#label_tag_query">
            &#9658; 自动标签范围 / Auto Labeling For
          </button>
          <select id="label_tag_query"
            class="form-select select-custom-tags px-3 collapse show ${bgColor}">
            <option value="未分類">未分类作品 / Uncategorized Only</option>
            <option value="">全部作品 / All Works</option>
          </select>
        </div>
        <div class="mb-4">
          <button type="button" class="btn p-0 mb-3" data-bs-toggle="collapse" data-bs-target="#advanced_label">&#9658; 高级设置 / Advanced</button>
          <div class="px-3 mb-4 collapse" id="advanced_label">
            <div class="mb-3">
              <label class="form-label fw-light" for="label_exclusion">
                忽略以下标签（空格/回车分割，区分大小写）
                <br />
                Ignore following tags (delimited by line/space, case-sensitive)
              </label>
              <textarea id="label_exclusion" class="form-control" rows="2" id="tag_alias" style="min-height: initial" placeholder="オリジナル"></textarea>
            </div>
            <div class="mb-3">
              <label class="form-label fw-light" for="label_add_first">
                无匹配时是否自动添加首个未被忽略的标签
                <br />
                Whether the first tag (not ignored) will be added if there is not any match
              </label>
              <select id="label_add_first" class="form-select ${bgColor}">
                <option value="false">否 / No</option>
                <option value="true">是 / Yes</option>
              </select>
            </div>
            <div class="mb-3">
              <label class="form-label fw-light" for="label_r18">
                是否为非全年龄作品标记#R-18标签
                <br />
                Whether NSFW works will be labeled as #R-18
              </label>
              <select id="label_r18" class="form-select ${bgColor}">
                <option value="true">标记 / Yes</option>
                <option value="false">忽略 / No</option>
              </select>
            </div>
            <div class="mb-3">
              <label class="form-label fw-light" for="label_safe">
                是否为全年龄作品标记#SFW标签
                <br />
                Whether SFW works will be labeled as #SFW
              </label>
              <select id="label_safe" class="form-select ${bgColor}">
                <option value="true">标记 / Yes</option>
                <option value="false">忽略 / No</option>
              </select>
            </div>
            <div class="mb-3">
              <label class="form-label fw-light" for="label_ai">
                是否为AI生成作品标记#AI标签
                <br />
                Whether AI-generated works will be labeled as #AI
              </label>
              <select id="label_ai" class="form-select ${bgColor}">
                <option value="true">标记 / Yes</option>
                <option value="false">忽略 / No</option>
              </select>
            </div>
            <div class="mb-3">
              <label class="form-label fw-light" for="label_author">
                是否将作者名与uid视为作品标签
                <br />
                Whether author name and uid will be regarded as part of work tags
              </label>
              <select id="label_author" class="form-select ${bgColor}">
                <option value="true">是 / Yes</option>
                <option value="false">否 / No</option>
              </select>
            </div>
            <div class="mb-3">
              <label class="form-label fw-light" for="label_strict">
                是否作品标签与用户标签需要严格匹配（角色名与作品名）
                <br />
                Whether the work tag and user tag need to be strictly match (both character name and work title)
              </label>
              <select id="label_strict" class="form-select ${bgColor}">
                <option value="true">是 / Yes</option>
                <option value="false">否 / No</option>
              </select>
            </div>
          </div>
        </div>
        <div class="mb-4">
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
        <button type="button" class="btn btn-outline-secondary me-3" data-bs-dismiss="modal">关闭 / Close</button>
        <button type="button" class="btn btn-outline-danger me-auto" style="white-space: nowrap"
          id="footer_stop_button">停止 / Stop
        </button>
        <button type="button" class="btn btn-outline-primary me-3"
          onclick="window.location.reload();">刷新 / Refresh</button>
        <button type="button" class="btn btn-outline-primary" style="white-space: nowrap"
          id="footer_label_button">开始 / Start
        </button>
      </div>
    </div>
  `;
  // backdrop pin
  labelModal.setAttribute(
    "data-bs-backdrop",
    backdropConfig ? "static" : "true"
  );
  const labelPinButton = labelModal.querySelector("#label_pin");
  labelPinButton.addEventListener("click", () => {
    const ins = bootstrap_.Modal.getOrCreateInstance(labelModal);
    const backdrop = ins["_config"]["backdrop"] === "static";
    if (backdrop) {
      ins["_config"]["backdrop"] = true;
      setValue("backdropConfig", "false");
      labelPinButton.innerHTML = svgUnpin;
    } else {
      ins["_config"]["backdrop"] = "static";
      setValue("backdropConfig", "true");
      labelPinButton.innerHTML = svgPin;
    }
  });
  // latest
  labelModal
    .querySelector("button#toggle_latest")
    .addEventListener("click", () => {
      setValue("version", version);
    });

  // search
  const searchModal = document.createElement("div");
  searchModal.className = "modal fade";
  searchModal.id = "search_modal";
  searchModal.tabIndex = -1;
  searchModal.innerHTML = `
    <div class="modal-dialog modal-xl d-flex flex-column ${bgColor} ${textColor}" style="pointer-events: initial">
      <div class="gallery overflow-auto no-scroll flex-grow-1 d-none"></div>
      <div class="modal-header">
        <h5 class="modal-title">搜索图片标签 / Search Bookmarks</h5>
        <button class="btn btn-close btn-close-empty ms-auto" id="search_pin">${defaultPinConfig}</button>
        <button class="btn btn-close btn-close-empty ms-3" data-bs-dismiss="modal">${svgClose}</button>
      </div>
      <form class="modal-body flex-grow-1 d-flex flex-column p-4" id="search_form">
          <div class="mb-4">
            <div class="mb-3">
              <label class="form-label" for="search_value">
                输入要搜索的关键字，使用空格分隔，在关键字前加<strong>感叹号</strong>来排除该关键字。将会结合用户设置的同义词词典，
                在收藏的图片中寻找标签匹配的图片展示在下方。当收藏时间跨度较大时，使用自定义标签缩小范围以加速搜索。
                <br />
                点击输入框右侧的切换按钮切换至高级搜索模式，此时可以限制该关键词的搜索范围，单个输入框只接受一个关键词。
                <br />
                Enter keywords seperated by spaces to launch a search. Add a <strong>Exclamation Mark</strong>
                before any keyword to exclude it. The search process will use your synonym dictionary to look up the tags
                of your bookmarked images. Use custom tag to narrow the search if images come from a wide time range.
                <br />
                Clicking the button on the right will toggle to advanced search mode, where you are able to choose
                the search fields of each keyword. Note that in this mode only single keyword is accepted for each input box.
              </label>
              <div id="basic_search_field"></div>
              <div class="d-none" id="advanced_search_fields"></div>
              <div class="mt-3" style="display: none">
                <div class="mb-2">您是否想要搜索 / Are you looking for:</div>
                <div class="ms-3" id="search_suggestion"></div>
              </div>
            </div>
            <button class="btn p-0 mb-3"
              data-bs-toggle="collapse" data-bs-target="#advanced_search"
              type="button" id="advanced_search_controller">&#9658; 高级设置 / Advanced</button>
            <div class="mb-3 px-3 collapse" id="advanced_search">
              <div class="mb-2">
                <label class="form-label fw-light">标签匹配模式 / Match Pattern</label>
                <select class="form-select ${bgColor}" id="search_exact_match">
                  <option value="fuzzy">模糊匹配 / Fuzzy Match</option>
                  <option value="exact">精确匹配 / Exact Match</option>
                </select>
              </div>
              <div class="mb-2">
                <label class="form-label fw-light">搜索标签数量匹配 / Search Tags Length Match</label>
                <select class="form-select ${bgColor}" id="search_length_match">
                  <option value="false">不需匹配 / Not Needed</option>
                  <option value="true">需要匹配 / Must Match</option>
                </select>
              </div>
              <div class="mb-2">
                <label class="form-label fw-light">自定义标签用于缩小搜索范围 / Custom Tag to Narrow the Search</label>
                <select class="form-select select-custom-tags ${bgColor}" id="search_select_tag">
                  <option value="">所有收藏 / All Works</option>
                  <option value="未分類">未分类作品 / Uncategorized Works</option>
                </select>
              </div>
              <div class="mb-2">
                <label class="form-label fw-light">作品公开类型 / Publication Type</label>
                <select class="form-select ${bgColor}" id="search_publication">
                  <option value="show">公开收藏 / Public</option>
                  <option value="hide">私密收藏 / Private</option>
                </select>
              </div>
            </div>
          </div>
          <div class="flex-grow-1">
            <div class="position-absolute start-50 top-50 spinner-border text-secondary" style="display: none" id="spinner">
            </div>
            <div class="row" id="search_results"></div>
            <div class="mb-2 text-end" id="search_prompt"></div>
            <button class="btn btn-outline-secondary w-100 py-1" style="display: none;" id="search_more">继续搜索 / Search More</button>
          </div>
      </form>
      <div class="modal-footer">
        <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">关闭 / Close</button>
        <button type="button" class="btn btn-outline-primary ms-auto" style="white-space: nowrap"
          id="footer_search_button">搜索 / Search</button>
      </div>
    </div>
  `;
  // backdrop pin
  searchModal.setAttribute(
    "data-bs-backdrop",
    backdropConfig ? "static" : "true"
  );
  const searchPinButton = searchModal.querySelector("#search_pin");
  searchPinButton.addEventListener("click", () => {
    const ins = bootstrap_.Modal.getOrCreateInstance(searchModal);
    const backdrop = ins["_config"]["backdrop"] === "static";
    if (backdrop) {
      ins["_config"]["backdrop"] = true;
      setValue("backdropConfig", "false");
      searchPinButton.innerHTML = svgUnpin;
    } else {
      ins["_config"]["backdrop"] = "static";
      setValue("backdropConfig", "true");
      searchPinButton.innerHTML = svgPin;
    }
  });

  const generatorModal = document.createElement("div");
  generatorModal.className = "modal fade";
  generatorModal.id = "generator_modal";
  generatorModal.tabIndex = -1;
  generatorModal.innerHTML = `
    <div class="modal-dialog modal-xl d-flex flex-column ${bgColor} ${textColor}" style="pointer-events: initial">
      <div class="gallery overflow-auto no-scroll flex-grow-1 d-none"></div>
      <div class="modal-header">
        <h5 class="modal-title">展示随机图片 / Display Shuffled Images</h5>
        <button class="btn btn-close btn-close-empty ms-auto" id="generator_pin">${defaultPinConfig}</button>
        <button class="btn btn-close btn-close-empty ms-3" data-bs-dismiss="modal">${svgClose}</button>
      </div>
      <div class="modal-body flex-grow-1 d-flex flex-column p-4 no-scroll">
        <div class="mb-4 flex-grow-1 d-none" id="generator_display">
          <div class="position-relative mb-4" style="height: 3rem" id="generator_spinner"><div class="position-absolute start-50 top-50 spinner-border text-secondary"></div></div>
          <div class="row" id="generator_results"></div>
          <button class="btn btn-outline-secondary w-100 py-1 d-none" id="generator_more">显示更多 / More</button>
          <div class="mt-3 text-end" id="generator_prompt"></div>
          <hr class="mt-4" />
        </div>
        <div>
          <label class="form-label mb-3">
            选择已收藏的标签，填写批量大小等参数后，点击<strong>生成</strong>按钮生成数组随机图片。
            点击<strong>保存至新标签</strong>可以按批次保存至临时标签，随后可以修改标签名称。
            <br />
            点击缩略图进入鉴赏模式，可以使用上下左右方向键切换浏览的图片，点击左上角X按钮回到原模式。
            <br />
            本功能可以用来随机浏览收藏的图片，或是将较大的收藏标签切分为数个较小的收藏标签。本页面仍在开发阶段，欢迎留言。
            <br />
            Select a tag you have bookmarked and set batch size and other configs before generating.
            Click on <strong>Generate</strong> to get batches of shuffled images. Click on <strong>Save to Tag</strong>
            will add a temperate tag to each batch that you can edit later.
            <br />
            Click on the thumbnail to enter gallery mode, where you can use four arrow key to switch between pages. Click the X on the top left to exit gallery mode.
            <br />
            This function is used to view random images, or slice a big tag into smaller ones. This page is in development and suggestions are welcomed.
          </label>
          <form class="mb-3" id="generator_form">
            <select class="mb-3 form-select select-custom-tags flex-grow-1 ${bgColor}" id="generator_select_tag">
              <option value="未分類">未分类作品 / Uncategorized Works</option>
              <option value="">所有收藏 / All Works</option>
            </select>
            <div class="row">
              <div class="col-4">
                <label for="generator_form_num" class="form-label fw-light">批量大小 / Batch Size</label>
                <input type="text" class="form-control me-3" value="100" id="generator_form_num" />
              </div>
              <div class="col-4">
                <label for="generator_form_publication" class="form-label fw-light">作品公开类型 / Publication Type</label>
                <select class="form-select ${bgColor}" id="generator_form_publication">
                  <option value="show">公开收藏 / Public</option>
                  <option value="hide">私密收藏 / Private</option>
                </select>
              </div>
              <div class="col-4">
                <label for="generator_form_restriction" class="form-label fw-light">作品限制类型 / Restriction Type</label>
                <select class="form-select ${bgColor}" id="generator_form_restriction">
                  <option value="all">全部作品 / All</option>
                  <option value="sfw">全年龄 / SFW</option>
                  <option value="nsfw">非全年龄 / NSFW</option>
                </select>
              </div>
            </div>
            <div class="mt-3 d-flex d-none" id="generator_form_buttons">
              <button type="button" class="btn btn-outline-primary me-auto">清除搜索 / Clear</button>
              <button type="button" class="btn btn-outline-primary">保存至标签 / Save to Tag</button>
              <button class="btn btn-outline-primary d-none">生成 / Generate</button>
            </div>
          </form>
          <div class="my-3 fw-bold text-center d-none" id="generator_save_tag_prompt"></div>
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-outline-secondary me-auto" data-bs-dismiss="modal">关闭 / Close</button>
        <button type="button" class="btn btn-outline-danger me-3" id="generator_footer_stop">停止 / Stop</button>
        <button type="button" class="btn btn-outline-primary" id="generator_footer_button">加载 / Load</button>
      </div>
    </div>
  `;
  generatorModal.setAttribute(
    "data-bs-backdrop",
    backdropConfig ? "static" : "true"
  );
  const generatorPin = generatorModal.querySelector("#generator_pin");
  generatorPin.addEventListener("click", () => {
    const ins = bootstrap_.Modal.getOrCreateInstance(generatorModal);
    const backdrop = ins["_config"]["backdrop"] === "static";
    if (backdrop) {
      ins["_config"]["backdrop"] = true;
      setValue("backdropConfig", "false");
      generatorPin.innerHTML = svgUnpin;
    } else {
      ins["_config"]["backdrop"] = "static";
      setValue("backdropConfig", "true");
      generatorPin.innerHTML = svgPin;
    }
  });
  const generatorButtons = generatorModal
    .querySelector("#generator_form_buttons")
    .querySelectorAll("button");
  generatorButtons[0].addEventListener("click", () => {
    generatedResults = null;
    generatorBookmarks.forEach((w) => (w.used = true));
    generatorDisplayLimit = 12;
    document.querySelector("#generator_form_buttons").classList.add("d-none");
    document.querySelector("#generator_display").classList.add("d-none");
    document.querySelector("#generator_spinner").classList.add("d-none");
    document.querySelector("#generator_more").classList.add("d-none");
    const resultsDiv = document.querySelector("#generator_results");
    while (resultsDiv.firstChild) {
      resultsDiv.removeChild(resultsDiv.firstChild);
    }
  });
  generatorButtons[1].addEventListener("click", async () => {
    window.runFlag = true;
    const tag = document.querySelector("#generator_select_tag").value;
    const restriction = document.querySelector(
      "#generator_form_restriction"
    ).value;
    const availableBookmarks = generatorBookmarks.filter(
      (w) =>
        restriction === "all" ||
        (restriction === "sfw" && !w["xRestrict"]) ||
        (restriction === "nsfw" && w["xRestrict"])
    );
    const batchSize = Math.max(
      0,
      parseInt(document.querySelector("#generator_form_num").value) || 100
    );
    const batchNum = Math.ceil(availableBookmarks.length / batchSize);
    const prompt = document.querySelector("#generator_save_tag_prompt");
    prompt.classList.remove("d-none");
    for (let index of [...Array(batchNum).keys()]) {
      if (!window.runFlag) break;
      const addTag = `S_${index}_${tag}`.slice(0, 30);
      prompt.innerText = `正在保存至 ${addTag} / Saving to ${addTag}`;
      const ids = availableBookmarks
        .slice(index * batchSize, (index + 1) * batchSize)
        .map((w) => w["bookmarkData"]["id"]);
      // console.log(addTag, ids);
      await updateBookmarkTags(ids, [addTag]);
    }
    window.runFlag = false;
    prompt.classList.add("d-none");
  });
  generatorModal
    .querySelector("#generator_footer_button")
    .addEventListener("click", () => generatorButtons[2].click());
  generatorModal
    .querySelector("#generator_footer_stop")
    .addEventListener("click", () => {
      window.runFlag = false;
      document
        .querySelector("#generator_save_tag_prompt")
        .classList.add("d-none");
    });
  generatorModal
    .querySelector("#generator_more")
    .addEventListener("click", (evt) => {
      const resultsDiv = document.querySelector("#generator_results");
      const s = resultsDiv.childElementCount;
      const textColor = theme
        ? "rgba(0, 0, 0, 0.88)"
        : "rgba(255, 255, 255, 0.88)";
      generatorDisplayLimit += 108;
      if (generatorDisplayLimit >= generatedResults.length) {
        evt.target.classList.add("d-none");
      }
      generatedResults
        .filter((_, i) => i >= s && i < generatorDisplayLimit)
        .forEach((w) => displayWork(w, resultsDiv, textColor));
    });

  const tagSelectionDialog = getValue("tagSelectionDialog", "false") === "true";

  /* eslint-disable indent */
  const featureModal = document.createElement("div");
  featureModal.className = "modal fade";
  featureModal.id = "feature_modal";
  featureModal.tabIndex = -1;
  featureModal.innerHTML = `
    <div class="modal-dialog modal-lg ${bgColor} ${textColor}" style="pointer-events: initial">
      <div class="modal-header">
        <h5 class="modal-title">其他功能 / Other Functions</h5>
        <button class="btn btn-close btn-close-empty ms-auto" data-bs-dismiss="modal">${svgClose}</button>
      </div>
      <div class="modal-body p-4">
        <label class="form-label mb-4" for="feature_select">
          本页面用于放置一些较为零散独立的功能。
          <br />
          This page contains some scattered and independent functions.
        </label>
        <div class="mb-4">
          <div class="row mb-3">
            <div class="col-6">
              <label for="feature_form_publication" class="form-label fw-light">作品公开类型 / Publication Type</label>
              <select class="form-select ${bgColor}" id="feature_form_publication">
                  <option value="show">公开收藏 / Public</option>
                  <option value="hide">私密收藏 / Private</option>
               </select>
            </div>
            <div class="col-6">
              <label for="feature_select_tag" class="form-label fw-light">作品标签 / Tag</label>
              <select class="col-6 form-select select-custom-tags flex-grow-1 ${bgColor}" id="feature_select_tag">
                <option value="">所有收藏 / All Works</option>
              </select>
            </div>
          </div>
          <div class="" id="feature_tag_buttons">
            <div class="mb-2">
              <button class="btn btn-outline-secondary me-3">更改作品公开类型 / Toggle Publication Type</button>
            </div>
            <div class="mb-3">
              <button class="btn btn-outline-danger me-3">删除该标签 / Delete This Tag</button>
              <button class="btn btn-outline-danger me-auto">清除作品标签 / Clear Work Tags</button>
            </div>
            <div class="">
              <input class="form-control mb-2" type="text" id="feature_new_tag_name" placeholder="新标签名 / New Tag Name" />
              <div class="d-flex">
                <button class="btn btn-outline-secondary me-3" style="white-space: nowrap">更改标签名称 / Rename Tag</button>
                <div class="form-check d-inline-block align-self-center">
                  <input class="form-check-input" type="checkbox" value="" id="feature_tag_update_dict">
                  <label class="form-check-label" for="feature_tag_update_dict">
                    更新词典中已存在的标签名 / Update Existed Tag Name in Dict
                  </label>
                </div>
              </div>
            </div>
          </div>
        </div>
        <hr class="my-3" />
        <div class="mb-4">
          <div class="fw-light mb-3">
            批量标记，或删除不可见作品，如果您有较早的收藏夹备份，可以使用下方的查询失效作品查找失效作品信息<br />
            Batch labeling or removing deleted/private works. If you have a previous backup of your bookmarks, you can use 'Lookup Invalid Works' below to get those invalid work details.
          </div>
          <div class="mb-2" id="feature_batch_remove_invalid_buttons">
            <button class="btn btn-outline-primary">加载失效作品信息 / Load Invalid Works</button>
          </div>
          <div class="d-none" id="feature_batch_remove_invalid_display"></div>
        </div>
        <hr class="my-3" />
        <div class="mb-4">
          <div class="fw-light mb-3">
            备份收藏夹，可用于查找失效作品信息，或在其他账户上导入收藏<br />
            Backup the bookmarks, in order to look up deleted/privated work details, or import them on another account
          </div>
          <div class="mb-2" id="feature_bookmark_buttons">
            <button class="btn btn-outline-primary me-3">备份收藏夹 / Backup Bookmarks</button>
            <button class="btn btn-outline-primary">查询失效作品信息 / Lookup Invalid Works</button>
          </div>
          <div class="mb-3" id="feature_import_bookmark">
            <button class="btn btn-outline-primary">导入收藏夹 / Import Bookmarks</button>
            <div class="d-none" id="feature_import_bookmark_hide">
              <div class="mb-2 fw-light">
                选择需要导入的标签进行导入。对于已存在的收藏，可以选择已收藏作品标签的合并模式。<br />再次点击上方按钮重新选择备份文件<br />
                Select desired tag to import. For existing bookmarks, two options are provided to merge tags. <br /> Click upper button to reselect another backup file.
              </div>
              <div class="row mb-3">
                <div class="col-3">
                  <label for="feature_import_bookmark_publication" class="form-label fw-light">公开类型 / Publication</label>
                  <select class="form-select ${bgColor}" id="feature_import_bookmark_publication">
                      <option value="show">公开收藏 / Public</option>
                      <option value="hide">私密收藏 / Private</option>
                   </select>
                </div>
                <div class="col-5">
                  <label for="feature_import_bookmark_tag" class="form-label fw-light">作品标签 / Tag</label>
                  <select class="col-6 form-select flex-grow-1 ${bgColor}" id="feature_import_bookmark_tag"></select>
                </div>
                <div class="col-4">
                  <label for="feature_import_bookmark_tag" class="form-label fw-light">模式 / Mode</label>
                  <select class="col-6 form-select flex-grow-1 ${bgColor}" id="feature_import_bookmark_mode">
                    <option value="merge">合并 / Merge</option>
                    <option value="override">覆盖 / Override</option>
                    <option value="skip">跳过 / Skip</option>
                  </select>
                </div>
              </div>
              <button class="btn btn-outline-primary me-3">导入 / Import</button>
            </div>
          </div>
          <div class="d-none" id="feature_bookmark_display"></div>
        </div>
        <hr class="my-3" />
        <div class="mb-4" id="feature_switch_tag_dialog">
          <div class="fw-light mb-3">
            替换标签选择对话框，原生对话框使用收藏数进行排序，替换后将依照读音、作品、角色等进行排序<br />
            Replace the native tag-selection dialog, which uses the number of works to sort. New dialog will display the tags in alphabetical order, divided by characters and others.
          </div>
          <button class="btn btn-outline-primary">${
            tagSelectionDialog ? "禁用 / Disable" : "启用 / Enable"
          }</button>
          <hr class="my-3" />
          <div class="fw-light mb-3">
            警告：加速模式下大部分网络请求之间的等待时间被移除，这使得收藏夹的加载更新速度变快，但也会增加您的账号被Pixiv封禁的风险，请谨慎决定是否使用该模式。<br />
            Warning: Most delay time between requests is removed in this mode, in order to speed up the loading and updating process of your bookmarks. But it will also increase the risk your account being banned by Pixiv. Please decide carefully whether to use this function.
          </div>
          <button class="btn btn-outline-danger">${
            turboMode ? "禁用 / Disable" : "启用 / Enable"
          }</button>
        </div>
        <div class="fw-bold text-center mt-4 d-none" id="feature_prompt"></div>
        <div class="progress mt-3 d-none" id="feature_modal_progress" style="min-height: 1rem">
          <div style="width: 0" class="progress-bar progress-bar-striped"
           id="feature_modal_progress_bar" role="progressbar"></div>
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-outline-secondary me-3" data-bs-dismiss="modal">关闭 / Close</button>
        <button type="button" class="btn btn-outline-primary me-auto" onclick="window.location.reload();">刷新 / Refresh</button>
        <button type="button" class="btn btn-outline-danger" id="feature_footer_stop_button">停止 / Stop</button>
      </div>
    </div>
  `;
  featureModal
    .querySelector("#feature_footer_stop_button")
    .addEventListener("click", () => (window.runFlag = false));
  /* eslint-disable indent */

  const featurePrompt = featureModal.querySelector("#feature_prompt");
  const featureProgress = featureModal.querySelector("#feature_modal_progress");
  const featureProgressBar = featureModal.querySelector(
    "#feature_modal_progress_bar"
  );

  // tag related
  const featurePublicationType = featureModal.querySelector(
    "#feature_form_publication"
  );
  const featureTag = featureModal.querySelector("#feature_select_tag");
  const featureTagButtons = featureModal
    .querySelector("#feature_tag_buttons")
    .querySelectorAll("button");
  async function featureFetchWorks(tag, publicationType, progressBar) {
    if (window.runFlag === false) return;
    window.runFlag = true;
    const tag_ = tag || featureTag.value;
    const publicationType_ = publicationType || featurePublicationType.value;
    if (tag_ === "" && cachedBookmarks[publicationType_])
      return cachedBookmarks[publicationType_];
    const progressBar_ = progressBar || featureProgressBar;
    featurePrompt.innerText =
      "正在获取收藏夹信息 / Fetching bookmark information";
    featurePrompt.classList.remove("d-none");
    if (!progressBar) featureProgress.classList.remove("d-none");
    const totalWorks = await fetchAllBookmarksByTag(
      tag_,
      publicationType_,
      progressBar_
    );
    if (DEBUG) console.log(totalWorks);
    if (tag_ === "" && totalWorks)
      cachedBookmarks[publicationType_] = totalWorks;
    return totalWorks || [];
  }
  // toggle publication type
  featureTagButtons[0].addEventListener("click", () =>
    featureFetchWorks().then(async (works) => {
      if (!works?.length) {
        return alert(
          `没有获取到收藏夹内容，操作中断，请检查选项下是否有作品\nFetching bookmark information failed. Abort operation. Please check the existence of works with the configuration`
        );
      }
      const tag = featureTag.value;
      const publicationType = featurePublicationType.value;
      const restrict = publicationType === "show" ? "private" : "public";
      if (
        !window.confirm(`标签【${tag || "所有作品"}】下所有【${
          publicationType === "show" ? "公开" : "非公开"
        }】作品（共${works.length}项）将会被移动至【${
          publicationType === "show" ? "非公开" : "公开"
        }】类型，是否确认操作？
All works of tag ${tag || "All Works"} and type ${
          publicationType === "show" ? "PUBLIC" : "PRIVATE"
        } (${
          works.length
        } in total) will be set as ${restrict.toUpperCase()}. Is this Okay?`)
      )
        return;
      const instance = bootstrap_.Modal.getOrCreateInstance(progressModal);
      instance.show();
      await updateBookmarkRestrict(
        works.map((w) => w["bookmarkData"]["id"]),
        restrict,
        progressBar
      );
      setTimeout(() => {
        instance.hide();
        if (window.runFlag && !hold) window.location.reload();
      }, 1000);
    })
  );
  // delete tag
  featureTagButtons[1].addEventListener("click", async () => {
    const publicationType = featurePublicationType.value;
    const tag = featureTag.value;
    await deleteTag(tag, publicationType);
  });
  // clear tag
  featureTagButtons[2].addEventListener("click", () =>
    featureFetchWorks().then(clearBookmarkTags)
  );
  // rename tag
  featureTagButtons[3].addEventListener("click", async () => {
    const tag = featureTag.value;
    let newName = featureModal.querySelector(
      "input#feature_new_tag_name"
    ).value;
    newName = newName.split(" ")[0].replace("（", "(").replace("）", ")");

    if (!tag || tag === "未分類")
      return window.alert(`无效的标签名\nInvalid tag name`);
    if (!newName)
      return window.alert(`新标签名不可以为空！\nEmpty New Tag Name!`);
    const type = featurePublicationType.value === "show" ? "public" : "private";
    if (userTagDict[type].find((e) => e.tag === newName))
      if (
        !window.confirm(
          `将会合并标签【${tag}】至【${newName}】，是否继续？\nWill merge tag ${tag} into ${newName}. Is this Okay?`
        )
      )
        return;
    if (
      !window.confirm(`是否将标签【${tag}】重命名为【${newName}】？\n与之关联的作品标签将被更新，该操作将同时影响公开和非公开收藏
Tag ${tag} will be renamed to ${newName}.\n All related works (both public and private) will be updated. Is this okay?`)
    )
      return;
    const updateDict = featureModal.querySelector(
      "#feature_tag_update_dict"
    ).checked;
    if (updateDict && synonymDict[tag]) {
      const value = synonymDict[tag];
      delete synonymDict[tag];
      synonymDict[newName] = value;
      const newDict = {};
      for (let key of sortByParody(Object.keys(synonymDict))) {
        newDict[key] = synonymDict[key];
      }
      synonymDict = newDict;
      setValue("synonymDict", synonymDict);
    }
    const startTime = Date.now();
    featurePrompt.innerText = "更新中 / Updating";
    featurePrompt.classList.remove("d-none");
    featureProgress.classList.remove("d-none");
    const id = setInterval(() => {
      fetch(
        `https://www.pixiv.net/ajax/illusts/bookmarks/rename_tag_progress?lang=${lang}`
      )
        .then((resRaw) => resRaw.json())
        .then((res) => {
          if (res.body["isInProgress"]) {
            const estimate = res.body["estimatedSeconds"];
            const elapsed = (Date.now() - startTime) / 1000;
            const ratio =
              Math.min((elapsed / (elapsed + estimate)) * 100, 100).toFixed(2) +
              "%";
            featureProgressBar.innerText = ratio;
            featureProgressBar.style.width = ratio;
          } else {
            clearInterval(id);
            featureProgressBar.innerText = "100%";
            featureProgressBar.style.width = "100%";
            featurePrompt.innerText = "更新成功 / Update Successfully";
            setTimeout(() => {
              if (!hold) window.location.reload();
            }, 1000);
          }
        });
    }, 1000);
    await fetch("https://www.pixiv.net/ajax/illusts/bookmarks/rename_tag", {
      headers: {
        accept: "application/json",
        "content-type": "application/json; charset=utf-8",
        "x-csrf-token": token,
      },
      body: JSON.stringify({ newTagName: newName, oldTagName: tag }),
      method: "POST",
    });
  });
  // batch removing invalid bookmarks
  const batchRemoveButton = featureModal
    .querySelector("#feature_batch_remove_invalid_buttons")
    .querySelector("button");
  batchRemoveButton.addEventListener("click", async () => {
    const display = featureModal.querySelector(
      "#feature_batch_remove_invalid_display"
    );
    featureProgress.classList.remove("d-none");
    const invalidShow = (
      await featureFetchWorks("", "show", featureProgressBar)
    ).filter((w) => w.title === "-----");
    if (DEBUG) console.log("invalidShow", invalidShow);
    const invalidHide = (
      await featureFetchWorks("", "hide", featureProgressBar)
    ).filter((w) => w.title === "-----");
    if (DEBUG) console.log("invalidHide", invalidHide);
    if (window.runFlag) {
      featurePrompt.classList.add("d-none");
      featureProgress.classList.add("d-none");
      if (invalidShow.length || invalidHide.length) {
        display.innerHTML =
          `<div class="row" style="max-height: 30vh; overflow-y: scroll;">` +
          [...invalidShow, ...invalidHide]
            .map((w) => {
              const { id, associatedTags, restrict, xRestrict } = w;
              const l = lang.includes("zh") ? 0 : 1;
              const info = [
                ["作品ID：", "ID: ", id],
                [
                  "用户标签：",
                  "User Tags: ",
                  (associatedTags || []).join(", "),
                ],
                [
                  "公开类型：",
                  "Publication: ",
                  restrict ? ["非公开", "hide"][l] : ["公开", "show"][l],
                ],
                ["限制分类：", "Restrict: ", xRestrict ? "R-18" : "SFW"],
              ];
              return `<div class="col-6 mb-2">${info
                .map((i) => `${i[l] + i[2]}`)
                .join("<br />")}</div>`;
            })
            .join("") +
          `</div>`;
        const buttonContainer = document.createElement("div");
        buttonContainer.className = "d-flex mt-3";
        const labelButton = document.createElement("button");
        labelButton.className = "btn btn-outline-primary";
        labelButton.innerText = "标记失效 / Label As Invalid";
        labelButton.addEventListener("click", async (evt) => {
          evt.preventDefault();
          if (
            !window.confirm(
              `是否确认批量为失效作品添加"INVALID"标签\nInvalid works (deleted/private) will be labelled as INVALID. Is this okay?`
            )
          )
            return;
          window.runFlag = true;
          const bookmarkIds = [...invalidShow, ...invalidHide]
            .filter((w) => !w.associatedTags.includes("INVALID"))
            .map((w) => w["bookmarkData"]["id"]);
          featureProgress.classList.remove("d-none");
          featurePrompt.classList.remove("d-none");
          featurePrompt.innerText =
            "添加标签中，请稍后 / Labeling invalid bookmarks";
          await updateBookmarkTags(
            bookmarkIds,
            ["INVALID"],
            null,
            featureProgressBar
          );
          featurePrompt.innerText =
            "标记完成，即将刷新页面 / Updated. The page is going to reload.";
          setTimeout(() => {
            if (window.runFlag && !hold) window.location.reload();
          }, 1000);
        });
        const removeButton = document.createElement("button");
        removeButton.className = "btn btn-outline-danger ms-auto";
        removeButton.innerText = "确认删除 / Confirm Removing";
        removeButton.addEventListener("click", async (evt) => {
          evt.preventDefault();
          if (
            !window.confirm(
              `是否确认批量删除失效作品\nInvalid works (deleted/private) will be removed. Is this okay?`
            )
          )
            return;
          window.runFlag = true;
          const bookmarkIds = [...invalidShow, ...invalidHide].map(
            (w) => w["bookmarkData"]["id"]
          );
          featureProgress.classList.remove("d-none");
          featurePrompt.classList.remove("d-none");
          featurePrompt.innerText =
            "删除中，请稍后 / Removing invalid bookmarks";
          await removeBookmark(bookmarkIds, featureProgressBar);
          featurePrompt.innerText =
            "已删除，即将刷新页面 / Removed. The page is going to reload.";
          setTimeout(() => {
            if (window.runFlag && !hold) window.location.reload();
          }, 1000);
        });
        buttonContainer.appendChild(labelButton);
        buttonContainer.appendChild(removeButton);
        display.appendChild(buttonContainer);
      } else {
        display.innerText = "未检测到失效作品 / No invalid works detected";
      }
      display.className = "mt-3";
    } else {
      featurePrompt.innerText = "操作中断 / Operation Aborted";
    }
    delete window.runFlag;
  });
  // bookmarks related
  const featureBookmarkButtons = featureModal
    .querySelector("#feature_bookmark_buttons")
    .querySelectorAll("button");
  // backup
  featureBookmarkButtons[0].addEventListener("click", async () => {
    featureProgress.classList.remove("d-none");
    const show = await featureFetchWorks("", "show", featureProgressBar);
    const hide = await featureFetchWorks("", "hide", featureProgressBar);
    if (window.runFlag) {
      const bookmarks = { show, hide };
      const a = document.createElement("a");
      a.href = URL.createObjectURL(
        new Blob([JSON.stringify(bookmarks)], { type: "application/json" })
      );
      a.setAttribute(
        "download",
        `label_pixiv_bookmarks_backup_${new Date().toLocaleDateString()}.json`
      );
      a.click();
      featurePrompt.innerText = "备份成功 / Backup successfully";
      featureProgress.classList.add("d-none");
    } else {
      featurePrompt.innerText = "操作中断 / Operation Aborted";
    }
    delete window.runFlag;
  });
  // lookup invalid
  const featureBookmarkDisplay = featureModal.querySelector(
    "#feature_bookmark_display"
  );
  featureBookmarkButtons[1].addEventListener("click", async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json";
    input.addEventListener("change", async (evt) => {
      const reader = new FileReader();
      reader.onload = async (evt) => {
        let json = {};
        const invalidArray = [];
        async function run(type) {
          const col = await featureFetchWorks("", type, featureProgressBar);
          if (!window.runFlag) return;
          for (let work of col.filter((w) => w.title === "-----")) {
            const jsonWork = json[type].find(
              (w) => w.id.toString() === work.id.toString()
            );
            invalidArray.push(jsonWork || work);
            if (DEBUG) console.log(jsonWork);
          }
        }
        try {
          eval("json = " + evt.target.result.toString());
          if (!json["show"])
            return alert(
              "请检查是否加载了正确的收藏夹备份\nPlease check if the backup file is correct"
            );
          if (DEBUG) console.log(json);
          featureProgress.classList.remove("d-none");
          await run("show");
          await run("hide");
          if (invalidArray.length) {
            featureBookmarkDisplay.innerHTML =
              `<div class="row" style="max-height: 30vh; overflow-y: scroll;">` +
              invalidArray
                .map((w) => {
                  const {
                    id,
                    title,
                    tags,
                    userId,
                    userName,
                    alt,
                    associatedTags,
                    restrict,
                    xRestrict,
                  } = w;
                  const l = lang.includes("zh") ? 0 : 1;
                  const info = [
                    ["", "", alt],
                    ["作品ID：", "ID: ", id],
                    ["作品名称：", "Title: ", title],
                    ["用户名称：", "User: ", userName + " - " + userId],
                    ["作品标签：", "Tags: ", (tags || []).join(", ")],
                    [
                      "用户标签：",
                      "User Tags: ",
                      (associatedTags || []).join(", "),
                    ],
                    [
                      "公开类型：",
                      "Publication: ",
                      restrict ? ["非公开", "hide"][l] : ["公开", "show"][l],
                    ],
                    ["限制分类：", "Restrict: ", xRestrict ? "R-18" : "SFW"],
                  ];
                  return `<div class="col-6 mb-2">${info
                    .map((i) => `${i[l] + i[2]}`)
                    .join("<br />")}</div>`;
                })
                .join("") +
              `</div>`;
          } else {
            featureBookmarkDisplay.innerText =
              "未检测到失效作品 / No invalid works detected";
          }
          featureBookmarkDisplay.className = "mt-3";
        } catch (err) {
          alert("无法加载收藏夹 / Fail to load bookmarks\n" + err);
          console.log(err);
        } finally {
          featurePrompt.classList.add("d-none");
          featureProgress.classList.add("d-none");
          delete window.runFlag;
        }
      };
      reader.readAsText(evt.target.files[0]);
    });
    input.click();
  });
  // import bookmarks
  const importBookmarkButtons = featureModal
    .querySelector("#feature_import_bookmark")
    .querySelectorAll("button");
  importBookmarkButtons[0].addEventListener("click", async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json";
    input.addEventListener("change", (evt) => {
      const reader = new FileReader();
      reader.onload = async (evt) => {
        let json = {};
        try {
          eval("json = " + evt.target.result.toString());
          if (!json["show"])
            return alert(
              "请检查是否加载了正确的收藏夹备份\nPlease check if the backup file is correct"
            );
          window.bookmarkImport = json;
          const selectTag = featureModal.querySelector(
            "#feature_import_bookmark_tag"
          );
          while (selectTag.firstChild) {
            selectTag.removeChild(selectTag.firstChild);
          }
          const tagShow = json["show"]
            .map((w) => w.associatedTags || [])
            .reduce((a, b) => [...new Set(a.concat(b))], []);
          const tagHide = json["hide"]
            .map((w) => w.associatedTags || [])
            .reduce((a, b) => [...new Set(a.concat(b))], []);
          console.log("tagShow", tagShow);
          console.log("tagHide", tagHide);
          const tagAll = sortByParody([...new Set(tagShow.concat(tagHide))]);
          console.log("tagAll", tagAll);
          const optionAll = document.createElement("option");
          optionAll.value = "";
          optionAll.innerText = `所有收藏 / All Works (${json["show"].length}, ${json["hide"].length})`;
          const optionUncat = document.createElement("option");
          optionUncat.value = "未分類";
          const uncatS = json["show"].filter(
            (w) => !(w.associatedTags || []).length
          ).length;
          const uncatH = json["hide"].filter(
            (w) => !(w.associatedTags || []).length
          ).length;
          optionUncat.innerText = `未分类作品 / Uncategorized Works (${uncatS}, ${uncatH})`;
          selectTag.appendChild(optionAll);
          selectTag.appendChild(optionUncat);
          tagAll.forEach((t) => {
            const option = document.createElement("option");
            option.value = t;
            const s = json["show"].filter((w) =>
              (w.associatedTags || []).includes(t)
            ).length;
            const h = json["hide"].filter((w) =>
              (w.associatedTags || []).includes(t)
            ).length;
            option.innerText = `${t} (${s}, ${h})`;
            selectTag.appendChild(option);
          });
          featureModal
            .querySelector("#feature_import_bookmark_hide")
            .classList.remove("d-none");
        } catch (err) {
          alert("无法加载收藏夹 / Fail to load bookmarks\n" + err);
          console.log(err);
        }
      };
      reader.readAsText(evt.target.files[0]);
    });
    input.click();
  });
  importBookmarkButtons[1].addEventListener("click", async () => {
    if (!window.bookmarkImport?.["show"])
      return alert("加载收藏夹备份失败！\nFail to load backup bookmarks");
    const json = window.bookmarkImport;
    const pub = featureModal.querySelector(
      "#feature_import_bookmark_publication"
    ).value;
    const tag = featureModal.querySelector(
      "#feature_import_bookmark_tag"
    ).value;
    const mode = featureModal.querySelector(
      "#feature_import_bookmark_mode"
    ).value;

    const importWorks = json[pub].filter((w) => {
      if (tag === "") return true;
      else if (tag === "未分類") return !w.associatedTags?.length;
      else return w.associatedTags?.includes(tag);
    });
    importWorks.reverse();

    featureProgress.classList.remove("d-none");
    const existWorks = await featureFetchWorks(tag, pub, featureProgressBar);
    featurePrompt.classList.remove("d-none");

    const errorList = [];
    window.runFlag = true;
    for (let i = 0; i < importWorks.length; i++) {
      const w = importWorks[i];
      if (!window.runFlag) break;
      let { id, title, restrict, associatedTags, alt } = w;
      if (title === "-----") {
        errorList.push({
          message: "The creator has limited who can view this content",
          ...w,
        });
        continue;
      }
      if (!associatedTags) associatedTags = [];
      const ew = existWorks.find((ew) => ew.id === id);
      if (ew) {
        // note that when work does not have target tag but is in exist bookmarked works, skip will not take effect
        if (mode === "skip") continue;
        const diff = (ew.associatedTags || []).filter(
          (t) => !associatedTags.includes(t)
        );
        associatedTags = associatedTags.filter(
          (t) => !(ew.associatedTags || []).includes(t)
        );
        if (!associatedTags) continue;
        if (mode === "merge")
          await updateBookmarkTags([ew["bookmarkData"]["id"]], associatedTags);
        else if (mode === "override")
          await updateBookmarkTags(
            [ew["bookmarkData"]["id"]],
            associatedTags,
            diff
          );
      } else {
        const resRaw = await addBookmark(id, restrict, associatedTags);
        if (!resRaw.ok) {
          const res = await resRaw.json();
          errorList.push({ ...res, ...w });
        }
      }
      featurePrompt.innerText = alt;
      featureProgressBar.innerText = i + "/" + importWorks.length;
      const ratio = ((i / importWorks.length) * 100).toFixed(2);
      featureProgressBar.style.width = ratio + "%";
    }
    if (!window.runFlag) {
      featurePrompt.innerText = "操作中断 / Operation Aborted";
    } else {
      featurePrompt.innerText = "导入成功 / Import successfully";
      featureProgress.classList.add("d-none");
    }
    if (errorList.length) {
      console.log(errorList);
      featurePrompt.innerText = "部分导入成功 / Import Partially Successful";
      featureBookmarkDisplay.classList.remove("d-none");
      featureBookmarkDisplay.innerText = errorList
        .map((w) => {
          const {
            id,
            title,
            tags,
            userId,
            userName,
            alt,
            associatedTags,
            xRestrict,
            message,
          } = w;
          return `${alt}\ntitle: ${title}\nid: ${id}\nuser: ${userName} - ${userId}\ntags: ${(
            tags || []
          ).join(", ")}\nuserTags: ${(associatedTags || []).join(
            ", "
          )}\nrestrict: ${xRestrict ? "R-18" : "SFW"}\nmessage: ${message}`;
        })
        .join("\n\n");
    }
  });
  // switch dialog
  const switchDialogButtons = featureModal
    .querySelector("#feature_switch_tag_dialog")
    .querySelectorAll("button");
  // dialog style
  switchDialogButtons[0].addEventListener("click", () => {
    const tagSelectionDialog = getValue("tagSelectionDialog", "false");
    if (tagSelectionDialog === "false") setValue("tagSelectionDialog", "true");
    else setValue("tagSelectionDialog", "false");
    window.location.reload();
  });
  // turbo mode
  switchDialogButtons[1].addEventListener("click", () => {
    if (turboMode) setValue("turboMode", "false");
    else setValue("turboMode", "true");
    window.location.reload();
  });

  // all tags selection modal
  const c_ = ALL_TAGS_CONTAINER.slice(1);
  const allTagsModal = document.createElement("div");
  allTagsModal.className = "modal fade";
  allTagsModal.id = "all_tags_modal";
  allTagsModal.tabIndex = -1;
  allTagsModal.innerHTML = `
    <div class="modal-dialog modal-xl ${bgColor} ${textColor}" style="pointer-events: initial">
      <div class="modal-header">
        <h5 class="modal-title">收藏标签一栏 / All Bookmark Tags</h5>
        <button class="btn btn-close btn-close-empty ms-auto" data-bs-dismiss="modal">${svgClose}</button>
      </div>
      <div class="modal-body p-4"><div class="${c_} mb-4"></div><div class="hpRxDJ"></div></div>
    </div>`;
  const parodyContainer = allTagsModal.querySelector(ALL_TAGS_CONTAINER);
  const characterContainer = [
    ...allTagsModal.querySelectorAll(ALL_TAGS_CONTAINER),
  ][1];
  userTags.forEach((tag) => {
    const d = document.createElement("div");
    d.className = "sc-1jxp5wn-2 cdeTmC";
    d.innerHTML = `
        <div class="sc-d98f2c-0 sc-1ij5ui8-1 RICfj sc-1xl36rp-0 iyuGOa" role="button">
          <div class="sc-1xl36rp-1 iUPWKW">
            <div class="sc-1xl36rp-2 bIDszS">
              <div title="#${tag}" class="sc-1utla24-0 bTtACY">#${tag}</div>
            </div>
          </div>
        </div>`;
    d.addEventListener("click", async () => {
      try {
        const c0 = document.querySelector(ALL_TAGS_MODAL_CONTAINER);
        const c1 = c0.lastElementChild;
        let lastScrollTop = -1;
        let targetDiv;
        let i = 0;
        while (
          c1.scrollTop !== lastScrollTop &&
          !targetDiv &&
          i < userTags.length
        ) {
          targetDiv = [...c1.firstElementChild.children].find((el) =>
            el.textContent.includes(tag)
          );
          if (!targetDiv) {
            c1.scrollTop = parseInt(
              c1.firstElementChild.lastElementChild.style.top
            );
            if ("onscrollend" in window)
              await new Promise((r) =>
                c1.addEventListener("scrollend", () => r(), { once: true })
              );
            else {
              let j = 0,
                lastText = c1.firstElementChild.lastElementChild.textContent;
              while (
                j < 10 &&
                lastText === c1.firstElementChild.lastElementChild.textContent
              ) {
                console.log("wait");
                await new Promise((r) => setTimeout(r, 100));
                j++;
              }
            }
          }
          i++;
        }
        if (targetDiv) {
          targetDiv.firstElementChild.click();
          allTagsModal.querySelector("button.btn-close").click();
        }
      } catch (err) {
        window.alert(`${err.name}: ${err.message}\n${err.stack}`);
      }
    });
    if (tag.includes("(")) characterContainer.appendChild(d);
    else parodyContainer.appendChild(d);
  });

  const progressModal = document.createElement("div");
  progressModal.className = "modal fade";
  progressModal.id = "progress_modal";
  progressModal.setAttribute("data-bs-backdrop", "static");
  progressModal.tabIndex = -1;
  progressModal.innerHTML = `
    <div class="modal-dialog modal-dialog-centered" style="pointer-events: initial">
      <div class="modal-body py-4 px-5 border border-secondary ${bgColor} ${textColor}">
        <div class="fs-5 mb-4 text-center">
          <div class="mt-4 mb-3">正在处理 / Working on</div>
          <div id="progress_modal_prompt"></div>
        </div>
        <div class="progress my-4" id="progress_modal_progress" style="min-height: 1rem">
          <div style="width: 0" class="progress-bar progress-bar-striped"
           id="progress_modal_progress_bar" role="progressbar"></div>
        </div>
        <div class="my-4 text-center">
          <button class="btn btn-danger" id="stop_remove_tag_button">停止 / Stop</button>
        </div>
      </div>
    </div>
  `;
  const progressBar = progressModal.querySelector(
    "#progress_modal_progress_bar"
  );

  const body = document.querySelector("body");
  body.appendChild(labelModal);
  body.appendChild(searchModal);
  body.appendChild(generatorModal);
  body.appendChild(featureModal);
  body.appendChild(progressModal);
  body.appendChild(allTagsModal);
}

async function fetchUserTags() {
  const tagsRaw = await fetch(
    `/ajax/user/${uid}/illusts/bookmark/tags?lang=${lang}`
  );
  const tagsObj = await tagsRaw.json();
  if (tagsObj.error === true)
    return alert(
      `获取tags失败
    Fail to fetch user tags` +
        "\n" +
        decodeURI(tagsObj.message)
    );
  userTagDict = tagsObj.body;
  const userTagsSet = new Set();
  for (let obj of userTagDict.public) {
    userTagsSet.add(decodeURI(obj.tag));
  }
  for (let obj of userTagDict["private"]) {
    userTagsSet.add(decodeURI(obj.tag));
  }
  userTagsSet.delete("未分類");
  return sortByParody(Array.from(userTagsSet));
}

async function fetchTokenPolyfill() {
  // get token
  const userRaw = await fetch(
    "/bookmark_add.php?type=illust&illust_id=83540927"
  );
  if (!userRaw.ok) {
    console.log(`获取身份信息失败
    Fail to fetch user information`);
    throw new Error();
  }
  const userRes = await userRaw.text();
  const tokenPos = userRes.indexOf("pixiv.context.token");
  const tokenEnd = userRes.indexOf(";", tokenPos);
  return userRes.slice(tokenPos, tokenEnd).split('"')[1];
}

async function updateWorkInfo(bookmarkTags) {
  const el = await waitForDom("section.sc-jgyytr-0.buukZm");
  let workInfo = {};
  for (let i = 0; i < 100; i++) {
    workInfo = Object.values(el)[0]["memoizedProps"]["children"][2]["props"];
    if (Object.keys(workInfo).length) break;
    else await delay(200);
  }
  if (bookmarkTags) {
    [...el.querySelectorAll("li")].forEach((li, i) => {
      workInfo["works"][i].associatedTags =
        Object.values(li)[0].child.child["memoizedProps"].associatedTags;
    });
  }
  const page = window.location.search.match(/p=(\d+)/)?.[1] || 1;
  workInfo.page = parseInt(page);
  return workInfo;
}

async function initializeVariables() {
  async function polyfill() {
    const dataLayer = unsafeWindow_["dataLayer"][0];
    uid = dataLayer["user_id"];
    lang = dataLayer["lang"];
    token = await fetchTokenPolyfill();
    pageInfo.userId = window.location.href.match(/users\/(\d+)/)?.[1];
    pageInfo.client = { userId: uid, lang, token };
  }

  try {
    pageInfo = Object.values(document.querySelector(BANNER))[0]["return"][
      "return"
    ]["memoizedProps"];
    if (DEBUG) console.log(pageInfo);
    uid = pageInfo["client"]["userId"];
    token = pageInfo["client"]["token"];
    lang = pageInfo["client"]["lang"];
    if (!uid || !token || !lang) await polyfill();
  } catch (err) {
    console.log(err);
    await polyfill();
  }

  userTags = await fetchUserTags();

  // workType = Object.values(document.querySelector(".sc-1x9383j-0"))[0].child["memoizedProps"]["workType"];

  // switch between default and dark theme
  const themeDiv = document.querySelector(THEME_CONTAINER);
  theme = themeDiv.getAttribute("data-theme") === "default";
  new MutationObserver(() => {
    theme = themeDiv.getAttribute("data-theme") === "default";
    const prevBgColor = theme ? "bg-dark" : "bg-white";
    const bgColor = theme ? "bg-white" : "bg-dark";
    const prevTextColor = theme ? "text-lp-light" : "text-lp-dark";
    const textColor = theme ? "text-lp-dark" : "text-lp-light";
    [...document.querySelectorAll(".bg-dark, .bg-white")].forEach((el) => {
      el.classList.replace(prevBgColor, bgColor);
    });
    [...document.querySelectorAll(".text-lp-dark, .text-lp-light")].forEach(
      (el) => {
        el.classList.replace(prevTextColor, textColor);
      }
    );
    const prevClearTag = theme ? "dydUg" : "jbzOgz";
    const clearTag = theme ? "jbzOgz" : "dydUg";
    const clearTagsButton = document.querySelector("#clear_tags_button");
    if (clearTagsButton)
      clearTagsButton.children[0].classList.replace(prevClearTag, clearTag);
  }).observe(themeDiv, { attributes: true });

  synonymDict = getValue("synonymDict", {});
  if (Object.keys(synonymDict).length) {
    // remove empty values on load, which could be caused by unexpected interruption
    for (let key of Object.keys(synonymDict)) {
      if (!synonymDict[key]) delete synonymDict[key];
    }
    setValue("synonymDict", synonymDict);
  }
}

const maxRetries = 100;
async function waitForDom(selector) {
  let dom;
  for (let i = 0; i < maxRetries; i++) {
    dom = document.querySelector(selector);
    if (dom) return dom;
    await delay(500);
  }
  throw new ReferenceError(
    `[Label Bookmarks] Dom element ${selector} not loaded in given time`
  );
}

async function injectElements() {
  const textColor = theme ? "text-lp-dark" : "text-lp-light";
  const pageBody = document.querySelector(PAGE_BODY);
  const root = document.querySelector("nav");
  root.classList.add("d-flex");
  const buttonContainer = document.createElement("span");
  buttonContainer.className = "flex-grow-1 justify-content-end d-flex";
  buttonContainer.id = "label_bookmarks_buttons";
  const gClass = generator ? "" : "d-none";
  const fClass = feature ? "" : "d-none";
  buttonContainer.innerHTML = `
        <button class="label-button ${textColor} ${fClass}" data-bs-toggle="modal" data-bs-target="#feature_modal" id="feature_modal_button"/>
        <button class="label-button ${textColor} ${gClass}" data-bs-toggle="modal" data-bs-target="#generator_modal" id="generator_modal_button"/>
        <button class="label-button ${textColor}" data-bs-toggle="modal" data-bs-target="#search_modal" id="search_modal_button"/>
        <button class="label-button ${textColor}" data-bs-toggle="modal" data-bs-target="#label_modal" id="label_modal_button"/>
      `;

  const clearTagsThemeClass = theme ? "jbzOgz" : "dydUg";
  const clearTagsText = lang.includes("zh") ? "清除标签" : "Clear Tags";
  const clearTagsButton = document.createElement("div");
  clearTagsButton.id = "clear_tags_button";
  clearTagsButton.className = "sc-1ij5ui8-0 QihHO sc-13ywrd6-7 tPCje";
  clearTagsButton.setAttribute("aria-disabled", "true");
  clearTagsButton.setAttribute("role", "button");
  clearTagsButton.innerHTML = `<div aria-disabled="true" class="sc-4a5gah-0 ${clearTagsThemeClass}">
            <div class="sc-4a5gah-1 kHyYuA">
              ${clearTagsText}
            </div>
          </div>`;
  clearTagsButton.addEventListener("click", handleClearBookmarkTags);

  const removeTagButton = document.createElement("div");
  removeTagButton.id = "remove_tag_button";
  removeTagButton.style.display = "none";
  removeTagButton.style.marginRight = "16px";
  removeTagButton.style.marginBottom = "12px";
  removeTagButton.style.color = "rgba(0, 0, 0, 0.64)";
  removeTagButton.style.cursor = "pointer";
  removeTagButton.innerHTML = `
    <div class="${theme ? "" : "icon-invert"}" style="margin-right: 4px">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-trash" viewBox="0 0 16 16">
        <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/>
        <path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/>
      </svg>
    </div>
    <div class="fw-bold ${textColor}" id="remove_tag_prompt"></div>
  `;
  removeTagButton.addEventListener("click", handleDeleteTag);

  async function injection(_, injectionObserver) {
    if (_) console.log(_);
    if (pageInfo["userId"] !== uid) return;
    if (injectionObserver) injectionObserver.disconnect();

    console.log("[Label Bookmarks] Try Injecting");

    const workInfo = await updateWorkInfo(true);
    if (DEBUG) console.log(workInfo);
    if (!workInfo["works"]) {
      if (injectionObserver)
        injectionObserver.observe(pageBody, { childList: true });
      return console.log("[Label Bookmarks] Abort Injection");
    }
    if (DEBUG) {
      console.log("user tags", userTags, userTagDict);
      console.log("dict:", synonymDict);
    }

    root.appendChild(buttonContainer);
    setElementProperties();
    setSynonymEventListener();
    setAdvancedSearch();

    // show user-labeled tags
    const ul = await waitForDom("ul.sc-9y4be5-1");
    async function updateAssociatedTagsCallback() {
      const workInfo = await updateWorkInfo(true);
      if (DEBUG) console.log("Page", workInfo.page, workInfo);
      [...ul.querySelectorAll("[type='illust']")].forEach((img, i) => {
        const tagsString = workInfo["works"][i].associatedTags
          .map((i) => "#" + i)
          .join(" ");
        const tagDiv = document.createElement("div");
        tagDiv.innerHTML = `<div class="my-1" style="font-size: 10px; color: rgb(61, 118, 153); pointer-events: none">
          ${tagsString}
        </div>`;
        const pa = img.parentElement;
        pa.insertBefore(tagDiv, pa.children[1]);
      });
    }
    if (showWorkTags) {
      await updateAssociatedTagsCallback();
      new MutationObserver(updateAssociatedTagsCallback).observe(ul, {
        childList: true,
      });
    }

    const editButtonContainer = await waitForDom(EDIT_BUTTON_CONTAINER);
    if (editButtonContainer) {
      editButtonContainer.style.justifyContent = "initial";
      editButtonContainer.firstElementChild.style.marginRight = "auto";
      editButtonContainer.insertBefore(
        removeTagButton,
        editButtonContainer.lastChild
      );
      let removeBookmarkContainerObserver;
      const editButtonObserver = new MutationObserver(
        async (MutationRecord) => {
          const { tag } = await updateWorkInfo();
          if (!MutationRecord[0].addedNodes.length) {
            // open edit mode
            const removeBookmarkContainer = document.querySelector(
              "div.sc-13ywrd6-4.cXBjgZ"
            );
            removeBookmarkContainer.appendChild(clearTagsButton);
            removeBookmarkContainerObserver = new MutationObserver(() => {
              const value =
                removeBookmarkContainer.children[2].getAttribute(
                  "aria-disabled"
                );
              clearTagsButton.setAttribute("aria-disabled", value);
              clearTagsButton.children[0].setAttribute("aria-disabled", value);
            });
            removeBookmarkContainerObserver.observe(
              removeBookmarkContainer.children[2],
              { attributes: true }
            );
            if (tag && tag !== "未分類") {
              document.querySelector("#remove_tag_prompt").innerText =
                lang.includes("zh") ? "删除标签 " + tag : "Delete Tag " + tag;
              removeTagButton.style.display = "flex";
            }
          } else {
            // exit edit mode
            removeTagButton.style.display = "none";
            if (removeBookmarkContainerObserver)
              removeBookmarkContainerObserver.disconnect();
            clearTagsButton.setAttribute("aria-disabled", "true");
            clearTagsButton.children[0].setAttribute("aria-disabled", "true");
          }
        }
      );
      editButtonObserver.observe(editButtonContainer, {
        childList: true,
      });
    }

    let lastTag = workInfo.tag;
    const tagsContainer = await waitForDom(ALL_TAGS_CONTAINER);
    new MutationObserver(async () => {
      const workInfo = await updateWorkInfo();
      if (lastTag !== workInfo.tag) {
        lastTag = workInfo.tag;
        const removeTagButton = document.querySelector("#remove_tag_button");
        if (!workInfo.tag || workInfo.tag === "未分類") {
          if (removeTagButton && removeTagButton.style.display === "flex") {
            removeTagButton.style.display = "none";
          }
        } else {
          if (
            workInfo["editMode"] &&
            removeTagButton &&
            removeTagButton.style.display === "none"
          ) {
            removeTagButton.style.display = "flex";
          }
          const removeTagButtonPrompt =
            document.querySelector("#remove_tag_prompt");
          if (removeTagButtonPrompt)
            removeTagButtonPrompt.innerText = lang.includes("zh")
              ? "删除标签 " + workInfo.tag
              : "Delete Tag " + workInfo.tag;
        }
      }
      if (DEBUG) console.log("Current Tag:", workInfo.tag);
    }).observe(tagsContainer, {
      subtree: true,
      childList: true,
    });

    const toUncategorized = document.querySelector(WORK_NUM);
    if (toUncategorized) {
      toUncategorized.style.cursor = "pointer";
      toUncategorized.onclick = () =>
        (window.location.href = `https://www.pixiv.net/users/${uid}/bookmarks/artworks/未分類`);
    }

    const tagSelectionDialog =
      getValue("tagSelectionDialog", "false") === "true";
    if (tagSelectionDialog) {
      // sort tags in popup
      new MutationObserver((MutationRecord) => {
        if (MutationRecord[0].addedNodes[0]) {
          const root = MutationRecord[0].addedNodes[0];
          const ul = root.querySelector("ul");
          if (ul) {
            [...ul.children]
              .sort((a, b) => {
                let iA = userTags.indexOf(a.textContent.slice(1));
                let iB = userTags.indexOf(b.textContent.slice(1));
                if (a.querySelector(ADD_TAGS_MODAL_ENTRY)) iA = -1;
                if (b.querySelector(ADD_TAGS_MODAL_ENTRY)) iB = -1;
                return iA - iB;
              })
              .forEach((node) => ul.appendChild(node));
          }
        }
      }).observe(document.body, {
        childList: true,
        subtree: false,
        attributes: false,
      });

      // all tags selection control
      const prevAllTagsButton = await waitForDom(ALL_TAGS_BUTTON);
      prevAllTagsButton.style.display = "none";
      addStyle(".ggMyQW { z-index: -1; }");
      const allTagsButton = document.createElement("div");
      allTagsButton.setAttribute("data-bs-toggle", "modal");
      allTagsButton.setAttribute("data-bs-target", "#all_tags_modal");
      allTagsButton.classList.add(ALL_TAGS_BUTTON.slice(1));
      allTagsButton.role = "button";
      allTagsButton.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-asterisk" viewBox="0 0 16 16">
      <path d="M8 0a1 1 0 0 1 1 1v5.268l4.562-2.634a1 1 0 1 1 1 1.732L10 8l4.562 2.634a1 1 0 1 1-1 1.732L9 9.732V15a1 1 0 1 1-2 0V9.732l-4.562 2.634a1 1 0 1 1-1-1.732L6 8 1.438 5.366a1 1 0 0 1 1-1.732L7 6.268V1a1 1 0 0 1 1-1z"/>
    </svg>`;
      const allTagsContainer = await waitForDom(ALL_TAGS_CONTAINER);
      allTagsContainer.appendChild(allTagsButton);
      allTagsButton.addEventListener("click", () => {
        document.querySelector(ALL_TAGS_BUTTON)?.click();
        const modal = document.querySelector("#all_tags_modal");
        modal.addEventListener("shown.bs.modal", () => modal.focus());
        modal.addEventListener("hidden.bs.modal", () => {
          document
            .querySelector(ALL_TAGS_MODAL)
            ?.querySelector("button")
            .click();
        });
      });
    }

    console.log("[Label Bookmarks] Injected");

    window.addEventListener(
      "popstate",
      () => {
        if (window.location.href.match(/\/users\/\d+\/bookmarks\/artworks/))
          delay(1000)
            .then(() => waitForDom(ALL_TAGS_CONTAINER))
            .then(createModalElements)
            .then(injectElements);
      },
      { once: true }
    );

    return true;
  }

  if (!(await injection())) {
    const pageObserver = new MutationObserver(injection);
    pageObserver.observe(pageBody, { childList: true });
  }
}

let timeout = null,
  prevKeyword = null;
async function updateSuggestion(
  evt,
  suggestionEl,
  searchDict,
  handleClickCandidateButton
) {
  clearTimeout(timeout);
  const keywordsArray = evt.target.value.split(" ");
  const keyword = keywordsArray[keywordsArray.length - 1]
    .replace(/^!/, "")
    .replace(/^！/, "");
  if (
    window.runFlag ||
    !keyword ||
    !keyword.length ||
    keyword === " " ||
    keyword === prevKeyword
  )
    return;
  timeout = setTimeout(async () => {
    suggestionEl.parentElement.style.display = "none";
    prevKeyword = keyword;
    setTimeout(() => (prevKeyword = null), 3000);
    while (suggestionEl.firstElementChild) {
      suggestionEl.removeChild(suggestionEl.firstElementChild);
    }
    if (keyword.toUpperCase() === "R-18") return;

    let candidates = [];
    if (searchDict) {
      let dictKeys = Object.keys(synonymDict).filter((el) =>
        stringIncludes(el, keyword)
      );
      if (dictKeys.length)
        candidates = dictKeys.map((dictKey) => ({
          tag_name: synonymDict[dictKey][0],
          tag_translation: dictKey,
        }));
      if (!candidates.length) {
        dictKeys = Object.keys(synonymDict).filter((key) =>
          arrayIncludes(
            synonymDict[key].map((i) => i.split("(")[0]),
            keyword.split("(")[0]
          )
        );
        if (dictKeys.length)
          candidates = dictKeys.map((dictKey) => ({
            tag_name: synonymDict[dictKey][0],
            tag_translation: dictKey,
          }));
      }
    }
    if (!candidates.length) {
      const resRaw = await fetch(
        `/rpc/cps.php?keyword=${encodeURI(keyword)}&lang=${lang}`
      );
      const res = await resRaw.json();
      candidates = res["candidates"].filter((i) => i["tag_name"] !== keyword);
    }
    if (candidates.length) {
      for (let candidate of candidates.filter((_, i) => i < 5)) {
        const candidateButton = document.createElement("button");
        candidateButton.type = "button";
        candidateButton.className = "btn p-0 mb-1 d-block";
        candidateButton.innerHTML = `${
          candidate["tag_translation"] || "<span>🈳</span>"
        } - ${candidate["tag_name"]}`;
        handleClickCandidateButton(candidate, candidateButton);
        suggestionEl.appendChild(candidateButton);
      }
    } else {
      const noCandidate = document.createElement("div");
      noCandidate.innerText = "无备选 / No Suggestion";
      suggestionEl.appendChild(noCandidate);
    }
    suggestionEl.parentElement.style.display = "block";
  }, 500);
}

function setElementProperties() {
  // label buttons
  const labelButton = document.querySelector("#label_modal_button");
  const searchButton = document.querySelector("#search_modal_button");
  const generatorButton = document.querySelector("#generator_modal_button");
  const featureButton = document.querySelector("#feature_modal_button");
  if (lang.includes("zh")) {
    labelButton.innerText = "添加标签";
    searchButton.innerText = "搜索图片";
    generatorButton.innerText = "随机图片";
    featureButton.innerText = "其他功能";
  } else {
    labelButton.innerText = "Label";
    searchButton.innerText = "Search";
    generatorButton.innerText = "Shuffle";
    featureButton.innerText = "Function";
  }
  addStyle(
    `.label-button {
         padding: 0 24px;
         background: transparent;
         font-size: 16px;
         font-weight: 700;
         border-top: 4px solid rgba(0, 150, 250, 0);
         border-bottom: none;
         border-left: none;
         border-right: none;
         line-height: 24px;
         background: transparent;
         transition: color 0.4s ease 0s, border 0.4s ease 0s;
       }
       .label-button:hover {
         border-top: 4px solid rgb(0, 150, 250);
       }`
  );

  // append user tags options
  const customSelects = [...document.querySelectorAll(".select-custom-tags")];
  customSelects.forEach((el) => {
    const uncat = el.querySelector("option[value='未分類']");
    if (uncat) {
      const t = "未分類";
      const pb = userTagDict.public.find((e) => e.tag === t)?.["cnt"] || 0;
      const pr = userTagDict["private"].find((e) => e.tag === t)?.["cnt"] || 0;
      uncat.innerText = `未分类作品 / Uncategorized Works (${pb}, ${pr})`;
    }
    userTags.forEach((tag) => {
      const option = document.createElement("option");
      option.value = tag;
      const pb = userTagDict.public.find((e) => e.tag === tag)?.["cnt"] || 0;
      const pr =
        userTagDict["private"].find((e) => e.tag === tag)?.["cnt"] || 0;
      option.innerText = tag + ` (${pb}, ${pr})`;
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
  addFirst.value = getValue("addFirst", "false");
  addFirst.onchange = () => setValue("addFirst", addFirst.value);

  const tagToQuery = document.querySelector("#label_tag_query");
  const tag = getValue("tagToQuery", "未分類");
  if (userTags.includes(tag)) tagToQuery.value = tag;
  // in case that tag has been deleted
  else tagToQuery.value = "未分類";
  tagToQuery.onchange = () => setValue("tagToQuery", tagToQuery.value);

  const labelR18 = document.querySelector("#label_r18");
  labelR18.value = getValue("labelR18", "true");
  labelR18.onchange = () => setValue("labelR18", labelR18.value);

  const labelSafe = document.querySelector("#label_safe");
  labelSafe.value = getValue("labelSafe", "false");
  labelSafe.onchange = () => setValue("labelSafe", labelSafe.value);

  const labelAI = document.querySelector("#label_ai");
  labelAI.value = getValue("labelAI", "false");
  labelAI.onchange = () => setValue("labelAI", labelAI.value);

  const labelAuthor = document.querySelector("#label_author");
  labelAuthor.value = getValue("labelAuthor", "false");
  labelAuthor.onchange = () => setValue("labelAuthor", labelAuthor.value);

  const exclusion = document.querySelector("#label_exclusion");
  exclusion.value = getValue("exclusion", "");
  exclusion.onchange = () => setValue("exclusion", exclusion.value);

  const labelStrict = document.querySelector("#label_strict");
  labelStrict.value = getValue("labelStrict", "true");
  labelStrict.onchange = () => setValue("labelStrict", labelStrict.value);

  // search bookmark form
  const searchForm = document.querySelector("#search_form");
  searchForm.onsubmit = handleSearch;
  const searchMore = document.querySelector("#search_more");
  const footerSearch = document.querySelector("#footer_search_button");
  footerSearch.onclick = () => searchMore.click();

  // generator form
  const generatorForm = document.querySelector("#generator_form");
  generatorForm.onsubmit = handleGenerate;

  document
    .querySelector("#stop_remove_tag_button")
    .addEventListener("click", () => (window.runFlag = false));
}

function setSynonymEventListener() {
  const targetTag = document.querySelector("#target_tag");
  const alias = document.querySelector("#tag_alias");
  const preview = document.querySelector("#synonym_preview");
  const buttons = document
    .querySelector("#synonym_buttons")
    .querySelectorAll("button");
  const lineHeight = parseInt(getComputedStyle(preview).lineHeight);

  const labelSuggestion = document.querySelector("#label_suggestion");
  targetTag.addEventListener("keyup", (evt) => {
    updateSuggestion(
      evt,
      labelSuggestion,
      false,
      (candidate, candidateButton) =>
        candidateButton.addEventListener("click", () => {
          alias.value = alias.value + " " + candidate["tag_name"];
        })
    ).catch(console.log);
  });
  targetTag.addEventListener("keyup", (evt) => {
    // scroll to modified entry
    const lines = preview.innerText.split("\n");
    let lineNum = lines.findIndex((line) => line.includes(evt.target.value));
    if (lineNum < 0) return;
    if (lines[lineNum].startsWith("\t")) lineNum--;
    if (lineHeight * lineNum) preview.scrollTop = lineHeight * lineNum;
  });
  targetTag.addEventListener("blur", (evt) => {
    if (Object.keys(synonymDict).includes(evt.target.value)) {
      const value = synonymDict[evt.target.value];
      if (value.length > 4) alias.value = value.join("\n");
      else alias.value = value.join(" ");
    }
  });

  // update preview
  function updatePreview(synonymDict) {
    let synonymString = "";
    for (let key of Object.keys(synonymDict)) {
      let value = synonymDict[key];
      if (value.length > 4) value = value.join("\n\t");
      else value = value.join(" ");
      synonymString += key + "\n\t" + value + "\n\n";
    }
    preview.innerText = synonymString
      ? synonymString
      : "加载词典一栏中提供了样例词典，可用于导入\nA synonym dictionary sample is provided in Load Dict section for importing";
  }
  updatePreview(synonymDict);

  // on json file load
  document
    .querySelector("#synonym_dict_input")
    .addEventListener("change", (evt) => {
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          let json = {};
          eval("json = " + evt.target.result.toString());
          if (Array.isArray(json)) synonymDict = json[0];
          else synonymDict = json;
          setValue("synonymDict", synonymDict);
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
    a.setAttribute(
      "download",
      `label_pixiv_bookmarks_synonym_dict_${new Date().toLocaleDateString()}.json`
    );
    a.click();
    setValue("lastBackupDict", Date.now());
  });
  // load alias
  buttons[1].addEventListener("click", (evt) => {
    evt.preventDefault();
    labelSuggestion.parentElement.style.display = "none";
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
    labelSuggestion.parentElement.style.display = "none";
    const targetValue = targetTag.value
      .split(" ")[0]
      .replace("（", "(")
      .replace("）", ")");
    // navigator.clipboard.writeText(targetValue).catch(console.log);
    const aliasValue = alias.value;
    if (aliasValue === "") {
      // delete
      if (
        synonymDict[targetValue] &&
        window.confirm(
          `将会删除 ${targetValue}，请确认\nWill remove ${targetValue}. Is this okay?`
        )
      ) {
        delete synonymDict[targetValue];
      }
    } else {
      const value = aliasValue
        .split(/[\s\r\n]/)
        .filter((i) => i)
        .map((i) => i.trim());
      if (synonymDict[targetValue]) {
        synonymDict[targetValue] = value; // update
      } else {
        synonymDict[targetValue] = value; // add and sort
        const newDict = {};
        for (let key of sortByParody(Object.keys(synonymDict))) {
          newDict[key] = synonymDict[key];
        }
        synonymDict = newDict;
      }
    }
    targetTag.value = "";
    alias.value = "";
    setValue("synonymDict", synonymDict);
    updatePreview(synonymDict);
  });
  // filter
  document
    .querySelector("input#synonym_filter")
    .addEventListener("input", (evt) => {
      const filter = evt.target.value;
      if (filter.length) {
        if (filter === " ") return;
        const filteredKeys = Object.keys(synonymDict).filter(
          (key) =>
            stringIncludes(key, filter) ||
            arrayIncludes(synonymDict[key], filter, null, null, true)
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
  // restore
  document
    .querySelector("button#label_restore_dict")
    .addEventListener("click", restoreSynonymDict);
  // get sample
  document
    .querySelector("button#label_dict_sample")
    .addEventListener("click", () => {
      const s =
        '{"Fate":["FGO","Fate/GrandOrder","Fate/StayNight","Fate/Zero","Fate/Extra","Fate/ExtraCCC","Fate/Apocrypha"],"EVA":["新世紀エヴァンゲリオン","エヴァンゲリオン","evangelion","Evangelion","eva","EVA","新世纪福音战士"]}';
      const a = document.createElement("a");
      a.href = URL.createObjectURL(
        new Blob([s], {
          type: "application/json",
        })
      );
      a.setAttribute("download", "synonym_dict_sample.json");
      a.click();
    });
  if (DEBUG) console.log("[Label Bookmarks] Synonym Dictionary Ready");
}

function setAdvancedSearch() {
  function generatePlaceholder() {
    const synonymDictKeys = Object.keys(synonymDict);
    return synonymDictKeys.length
      ? "eg: " +
          synonymDictKeys[
            Math.floor(Math.random() * synonymDictKeys.length)
          ].split("(")[0]
      : "";
  }
  function generateBasicField() {
    const fieldContainer = document.createElement("div");
    fieldContainer.className = "d-flex";
    const searchInput = document.createElement("input");
    searchInput.className = "form-control";
    searchInput.required = true;
    searchInput.id = "search_value";
    searchInput.setAttribute("placeholder", generatePlaceholder());
    // search with suggestion
    const searchSuggestion = document.querySelector("#search_suggestion");
    searchInput.addEventListener("keyup", (evt) => {
      updateSuggestion(
        evt,
        searchSuggestion,
        true,
        (candidate, candidateButton) =>
          candidateButton.addEventListener("click", () => {
            const keywordsArray = searchInput.value.split(" ");
            const keyword = keywordsArray[keywordsArray.length - 1];
            let newKeyword = candidate["tag_name"];
            if (keyword.match(/^!/) || keyword.match(/^！/))
              newKeyword = "!" + newKeyword;
            keywordsArray.splice(keywordsArray.length - 1, 1, newKeyword);
            searchInput.value = keywordsArray.join(" ");
          })
      ).catch(console.log);
    });
    const toggleBasic = document.createElement("button");
    toggleBasic.style.border = "1px solid #ced4da";
    toggleBasic.className = "btn btn-outline-secondary ms-2";
    toggleBasic.type = "button";
    toggleBasic.addEventListener("click", () => {
      basic.classList.add("d-none");
      basic.removeChild(basic.firstChild);
      advanced.appendChild(generateAdvancedField(0));
      advanced.classList.remove("d-none");
    });
    toggleBasic.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-toggles" viewBox="0 0 16 16">
      <path d="M4.5 9a3.5 3.5 0 1 0 0 7h7a3.5 3.5 0 1 0 0-7h-7zm7 6a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5zm-7-14a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zm2.45 0A3.49 3.49 0 0 1 8 3.5 3.49 3.49 0 0 1 6.95 6h4.55a2.5 2.5 0 0 0 0-5H6.95zM4.5 0h7a3.5 3.5 0 1 1 0 7h-7a3.5 3.5 0 1 1 0-7z"/>
    </svg>`;
    fieldContainer.appendChild(searchInput);
    fieldContainer.appendChild(toggleBasic);
    return fieldContainer;
  }
  function generateAdvancedField(index) {
    const fieldContainer = document.createElement("div");
    fieldContainer.className = "mb-3";
    const inputContainer = document.createElement("div");
    inputContainer.className = "d-flex mb-2";
    inputContainer.innerHTML = `<input type="text" class="advanced_search_field form-control" required>`;
    if (!index) {
      inputContainer.firstElementChild.setAttribute(
        "placeholder",
        generatePlaceholder()
      );
      const toggleAdvanced = document.createElement("button");
      toggleAdvanced.style.border = "1px solid #ced4da";
      toggleAdvanced.className = "btn btn-outline-secondary ms-2";
      toggleAdvanced.type = "button";
      toggleAdvanced.addEventListener("click", () => {
        const basic = document.querySelector("#basic_search_field");
        const advanced = document.querySelector("#advanced_search_fields");
        basic.appendChild(generateBasicField());
        basic.classList.remove("d-none");
        advanced.classList.add("d-none");
        while (advanced.firstChild) {
          advanced.removeChild(advanced.firstChild);
        }
      });
      toggleAdvanced.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-toggles" viewBox="0 0 16 16">
        <path d="M4.5 9a3.5 3.5 0 1 0 0 7h7a3.5 3.5 0 1 0 0-7h-7zm7 6a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5zm-7-14a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zm2.45 0A3.49 3.49 0 0 1 8 3.5 3.49 3.49 0 0 1 6.95 6h4.55a2.5 2.5 0 0 0 0-5H6.95zM4.5 0h7a3.5 3.5 0 1 1 0 7h-7a3.5 3.5 0 1 1 0-7z"/>
      </svg>`;
      const addFieldButton = document.createElement("button");
      addFieldButton.style.border = "1px solid #ced4da";
      addFieldButton.className = "btn btn-outline-secondary ms-2";
      addFieldButton.type = "button";
      addFieldButton.addEventListener("click", () => {
        const advanced = document.querySelector("#advanced_search_fields");
        advanced.appendChild(generateAdvancedField(advanced.childElementCount));
      });
      addFieldButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-plus-lg" viewBox="0 0 16 16">
        <path fill-rule="evenodd" d="M8 2a.5.5 0 0 1 .5.5v5h5a.5.5 0 0 1 0 1h-5v5a.5.5 0 0 1-1 0v-5h-5a.5.5 0 0 1 0-1h5v-5A.5.5 0 0 1 8 2Z"/>
      </svg>`;
      inputContainer.appendChild(toggleAdvanced);
      inputContainer.appendChild(addFieldButton);
    } else {
      const removeFieldButton = document.createElement("button");
      removeFieldButton.style.border = "1px solid #ced4da";
      removeFieldButton.className = "btn btn-outline-secondary ms-2";
      removeFieldButton.type = "button";
      removeFieldButton.addEventListener("click", () => {
        const advanced = document.querySelector("#advanced_search_fields");
        advanced.removeChild(fieldContainer);
      });
      removeFieldButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-dash-lg" viewBox="0 0 16 16">
        <path fill-rule="evenodd" d="M2 8a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11A.5.5 0 0 1 2 8Z"/>
      </svg>`;
      inputContainer.appendChild(removeFieldButton);
    }
    const configContainer = document.createElement("div");
    configContainer.className = "row";
    [
      "标题/Title",
      "作者/Author",
      "作品标签/Work Tags",
      "用户标签/Bookmark Tags",
    ].forEach((name) => {
      const id = name.split("/")[0] + index;
      const container = document.createElement("div");
      container.className = "col-3";
      container.innerHTML = `<div class="form-check">
        <input type="checkbox" class="form-check-input" id=${id} checked="true">
        <label class="form-check-label" for=${id}>${name}</label>
      </div>`;
      configContainer.appendChild(container);
    });
    fieldContainer.appendChild(inputContainer);
    fieldContainer.appendChild(configContainer);
    return fieldContainer;
  }
  const basic = document.querySelector("#basic_search_field");
  const advanced = document.querySelector("#advanced_search_fields");
  basic.appendChild(generateBasicField());
}

function registerMenu() {
  showWorkTags = getValue("showWorkTags", "false") === "true";
  if (showWorkTags)
    GM_registerMenuCommand_("隐藏用户标签 / Hide User Tags", () => {
      setValue("showWorkTags", "false");
      window.location.reload();
    });
  else
    GM_registerMenuCommand_("显示用户标签 / Show User Tags", () => {
      setValue("showWorkTags", "true");
      window.location.reload();
    });
  generator = getValue("showGenerator", "false") === "true";
  if (generator)
    GM_registerMenuCommand_("关闭随机图片 / Disable Shuffled Images", () => {
      setValue("showGenerator", "false");
      window.location.reload();
    });
  else
    GM_registerMenuCommand_("启用随机图片 / Enable Shuffled Images", () => {
      setValue("showGenerator", "true");
      window.location.reload();
    });
  feature = getValue("showFeature", "false") === "true";
  if (feature)
    GM_registerMenuCommand_(
      "关闭其他功能 / Disable Additional Functions",
      () => {
        setValue("showFeature", "false");
        window.location.reload();
      }
    );
  else
    GM_registerMenuCommand_(
      "显示其他功能 / Enable Additional Functions",
      () => {
        setValue("showFeature", "true");
        window.location.reload();
      }
    );
  DEBUG = getValue("DEBUG", "false") === "true";
  if (DEBUG)
    GM_registerMenuCommand_("关闭详细日志 / Disable Verbose Logging", () => {
      setValue("DEBUG", "false");
      window.location.reload();
    });
  else
    GM_registerMenuCommand_("启用详细日志 / Enable Verbose Logging", () => {
      setValue("DEBUG", "true");
      window.location.reload();
    });
  turboMode = getValue("turboMode", "false") === "true";
}

(function () {
  "use strict";
  loadResources();
  registerMenu();
  waitForDom("nav")
    .then(initializeVariables)
    .then(createModalElements)
    .then(injectElements);
})();
