// ==UserScript==
// @name         Pixiv收藏夹自动标签
// @name:en      Label Pixiv Bookmarks
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  自动为Pixiv收藏夹内图片打上已有的标签
// @description:en    Automatically add existing labels for images in the bookmarks
// @author       Ziqing19
// @match        https://www.pixiv.net/*users/*/bookmarks/artworks*
// @match        https://www.pixiv.net/bookmark.php*
// @icon         https://www.google.com/s2/favicons?domain=pixiv.net
// @resource     bootstrapCSS https://cdn.jsdelivr.net/npm/bootstrap@5.0.1/dist/css/bootstrap.min.css
// @grant        GM_getResourceURL
// ==/UserScript==

function cssElement(url) {
  const link = document.createElement("link");
  link.href = url;
  link.rel="stylesheet";
  link.type="text/css";
  return link;
}

const delay = ms => new Promise(res => setTimeout(res, ms));

async function handleUpdate(token, illust_id, tags, retainComment, restricted) {
  const PIXIV_API_URL = "https://www.pixiv.net/rpc/index.php";
  const mode = "save_illust_bookmark";
  
  let comment;
  // get comment from the detailed page
  if (retainComment) {
    const commentRaw = await fetch("https://www.pixiv.net/bookmark_add.php?type=illust&illust_id=" + illust_id);
    const commentRes = await commentRaw.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(commentRes, "text/html");
    comment = doc.querySelector("div.input-box.ui-counter").firstElementChild.value;
  } else {
    comment = "";
  }
  
  await fetch(PIXIV_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
    },
    credentials: "same-origin",
    body: [
      `mode=${mode}`,
      `illust_id=${illust_id}`,
      `restrict=${!!restricted? 1 : 0}`,
      'comment'+(!!comment ? `=${comment}` : ''),
      'tags'+(!!tags ? `=${tags}` : ''),
      `tt=${token}`,
    ].join('&'),
  });
}

async function handleStart(addFirst, addSAFE, tag, retainComment, publicationType) {
  window.runFlag = true;
  document.querySelector("#prompt").innerText = `处理中，请勿关闭窗口
  Processing. Please do not close the window.
  `;
  
  // get token
  const tokenRaw = await fetch("https://www.pixiv.net/bookmark_add.php?type=illust&illust_id=83540927");
  if (!tokenRaw.ok) {
    return alert(`获取token失败
    Fail to fetch token`);
  }
  const tokenRes = await tokenRaw.text();
  const tokenPos = tokenRes.indexOf("pixiv.context.token");
  const tokenEnd = tokenRes.indexOf(";", tokenPos);
  const token = tokenRes.slice(tokenPos, tokenEnd).split("\"")[1];
  // TODO
  // console.log(token);
  
  // get user uid
  const uidRaw = await fetch("https://www.pixiv.net/bookmark.php");
  if (!uidRaw.ok) {
    return alert(`获取uid失败
    Fail to fetch uid`);
  }
  const uidRes = await uidRaw.text();
  const uidPos = uidRes.indexOf("pixiv.context.userId");
  const uidEnd = uidRes.indexOf(";", uidPos);
  const uid = uidRes.slice(uidPos, uidEnd).split("\"")[1];
  // TODO
  // console.log(uid);
  
  // get user tags
  const tagsRaw = await fetch("https://www.pixiv.net/ajax/user/" + uid + "/illusts/bookmark/tags");
  if (!tagsRaw.ok) {
    return alert(`获取tags失败
    Fail to fetch user tags`);
  }
  const tagsObj = await tagsRaw.json();
  const userTagsSet = new Set();
  for (let obj of tagsObj.body.public) {
    userTagsSet.add(obj.tag);
  }
  for (let obj of tagsObj.body.private) {
    userTagsSet.add(obj.tag);
  }
  const userTags = Array.from(userTagsSet);
  // TODO
  // console.log(userTags);
  
  // fetch bookmarks
  let total, index = 0, offset = 0;
  // update progress bar
  const progressBar = document.querySelector("#progress_bar");
  const intervalId =  setInterval(() => {
    if (total) {
      progressBar.innerText = index + "/" + total;
      const ratio = (index / total * 100).toFixed(2);
      progressBar.style.width = ratio + "%";
      if (!window.runFlag || index === total) {
        clearInterval(intervalId);
      }
    }
  }, 1000);
  do {
    const real_offset = tag === "未分類" ? offset : index;
    const bookmarksRaw = await fetch("https://www.pixiv.net/ajax/user/" + uid
      + "/illusts/bookmarks?tag=" + tag + "&offset="+ real_offset +"&limit=100&rest=" + publicationType);
    if (!bookmarksRaw.ok) {
      return alert(`获取用户收藏夹列表失败
    Fail to fetch user bookmarks`);
    }
    const bookmarksRes = await bookmarksRaw.json();
    const bookmarks = bookmarksRes.body;
    // TODO
    // console.log(bookmarks);
    if (!total) {
      total = bookmarks.total;
    }
    for (let work of bookmarks.works) {
      console.log(index, work.title, work.id);
      if (work.title !== "-----") {
        const illust_id = work.id;
        const work_tags = work.tags;
        const intersection = userTags.filter(tag => {
          if (work_tags.includes(tag)) return true;
          const stripped = tag.split("(")[0];
          return work_tags.includes(stripped);
        });
        if (addFirst === "true") {
          if (intersection.length === 0) {
            intersection.push(work_tags[0]);
            userTags.push(work_tags[0]);
          }
        }
        if (addSAFE === "true") {
          if (!work_tags.includes("R-18") && !work_tags.includes("R-18G")) {
            intersection.push("SAFE");
          }
        }
        // only if the tags need to be modified
        // skip those unavailable links
        if (intersection.length !== 0) {
          await handleUpdate(token, illust_id, intersection.join("+"),
            retainComment === "true", publicationType === "show" ? 0 : 1);
        } else {
          offset++;
        }
      }
      // work is not available now, skip
      else {
        offset++;
      }
      // in case that runs too fast
      delay(500).catch(console.log);
      index++;
      if (!window.runFlag) return;
    }
    if (bookmarks.works.length === 0) {
      return window.runFlag = false;
    }
  } while (index < total);
  if (total === 0) {
    document.querySelector("#prompt").innerText = `指定分类下暂无符合要求的作品，请关闭窗口
  Works needed to be labeled not found. Please close the window.
  `
  } else {
    document.querySelector("#prompt").innerText = `自动添加标签已完成，请关闭窗口并刷新网页
  Auto labeling finished successfully. Please close the window and refresh.
  `
  }
}

(function() {
  'use strict';
  document.head.appendChild(cssElement(GM_getResourceURL ("bootstrapCSS")));
  if (window.location.href.includes("https://www.pixiv.net/bookmark.php")) {
    const h1Elements = document.querySelectorAll("h1");
    for (let el of h1Elements) {
      el.style.fontSize = "1rem";
    }
  }
  
  const popup = document.createElement("div");
  popup.style.width = "38rem";
  popup.style.position = "fixed";
  popup.style.left = "calc(50vw - 19rem)";
  if (window.matchMedia("(min-height: 60rem)").matches) {
    popup.style.minHeight = "50rem";
    popup.style.maxHeight = "90vh";
    popup.style.top = "calc(50vh - 35rem)";
  } else {
    popup.style.height = "100vh - 2rem";
    popup.style.top = "1rem";
  }
  popup.style.overflowX = "hidden";
  popup.style.background = "rgb(245,245,245)";
  popup.style.display = "none";
  popup.classList = "py-3 px-4 rounded border border-secondary flex-column";
  popup.id = "popup";
  
  const inner = document.createElement("div");
  inner.style.width = "39rem";
  inner.style.paddingRight = "2.5rem";
  inner.style.overflowY = "scroll";
  
  const closeDiv = document.createElement("div");
  closeDiv.classList = "d-flex justify-content-end mb-3";
  const close = document.createElement("button");
  close.classList = "btn btn-close";
  close.addEventListener("click", () => {
    document.querySelector("#popup").style.display = "none";
  })
  closeDiv.appendChild(close);
  
  const promptDiv = document.createElement("div");
  promptDiv.id = "prompt";
  promptDiv.classList = "flex-grow-1 text-center mb-4";
  promptDiv.innerHTML = `
    <div>如果对以下配置有疑惑，请参考
    <a href="https://greasyfork.org/zh-CN/scripts/423823-pixiv%E6%94%B6%E8%97%8F%E5%A4%B9%E8%87%AA%E5%8A%A8%E6%A0%87%E7%AD%BE?locale_override=1" style="text-decoration: underline">文档</a>
    </div>
    <div>Please refer to the
    <a href="https://greasyfork.org/en/scripts/423823-pixiv%E6%94%B6%E8%97%8F%E5%A4%B9%E8%87%AA%E5%8A%A8%E6%A0%87%E7%AD%BE" style="text-decoration: underline">document</a> if confused.
    </div>`;
  
  const select0 = document.createElement("select");
  select0.id = "select0";
  select0.classList = "form-select mb-4";
  const label0 = document.createElement("label");
  label0.htmlFor = "select0";
  label0.innerText = `无匹配时是否自动添加首个标签
    Whether the first tag will be added if there is not any match
    `;
  label0.classList = "form-label mb-3 fw-light";
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
  select1.classList = "form-select mb-4";
  const label1 = document.createElement("label");
  label1.htmlFor = "select1";
  label1.innerText = `是否为非R18作品自动添加"SAFE"标签
    Whether the "SAFE" tag will be added to non-R18 works
    `;
  label1.classList = "form-label mb-3 fw-light";
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
  select2.classList = "form-select mb-4";
  const label2 = document.createElement("label");
  label2.htmlFor = "select2";
  label2.innerText = `自动标签范围
    Auto Labeling For
  `;
  label2.classList = "form-label mb-3 fw-light";
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
  })
  
  const inputDiv0 = document.createElement("div")
  inputDiv0.id = "input_div_0";
  inputDiv0.classList = "mb-4"
  inputDiv0.style.display = "none";
  const input0 = document.createElement("input");
  input0.id = "input0";
  input0.classList = "form-control"
  const labelInput0 = document.createElement("label");
  labelInput0.htmlFor = "input0";
  labelInput0.innerText = `自定义标签
  Custom Tag
  `
  labelInput0.classList = "form-label mb-3 fw-light";
  inputDiv0.appendChild(labelInput0);
  inputDiv0.appendChild(input0);
  
  const select3 = document.createElement("select");
  select3.id = "select3";
  select3.classList = "form-select mb-4";
  const label3 = document.createElement("label");
  label3.htmlFor = "select3";
  label3.innerText = `是否保留收藏评论（可能会降低性能）
    Whether the bookmark comment will be retained? (May reduce the performance)
  `;
  label3.classList = "form-label mb-3 fw-light";
  const option30 = document.createElement("option");
  option30.innerText = "舍弃 / No";
  option30.value = "false";
  const option31 = document.createElement("option");
  option31.innerText = "保留 / Yes";
  option31.value = "true";
  select3.appendChild(option30);
  select3.appendChild(option31);
  
  const select4 = document.createElement("select");
  select4.id = "select4";
  select4.classList = "form-select mb-4";
  const label4 = document.createElement("label");
  label4.htmlFor = "select4";
  label4.innerText = `作品公开类型
  Publication Type for Labeling
  `;
  label4.classList = "form-label mb-3 fw-light";
  const option40 = document.createElement("option");
  option40.innerText = "公开 / Public";
  option40.value = "show";
  const option41 = document.createElement("option");
  option41.innerText = "私密 / Private";
  option41.value = "hide";
  select4.appendChild(option40);
  select4.appendChild(option41);
  
  const labelProgress = document.createElement("label");
  const progress = document.createElement("div");
  const progressBar = document.createElement("div");
  progress.id = "progress";
  progress.style.minHeight = "1rem";
  progress.classList = "progress mb-5";
  progressBar.classList = "progress-bar progress-bar-striped progress-bar-animated";
  progressBar.role = "progressbar";
  progressBar.id = "progress_bar";
  progressBar.style.width = "0";
  labelProgress.htmlFor = "progress";
  labelProgress.innerText = `执行进度
  Progress`;
  labelProgress.classList = "form-label mb-3 fw-light";
  progress.appendChild(progressBar);
  
  const buttonDiv = document.createElement("div");
  buttonDiv.classList = "d-flex my-4";
  const closeButton = document.createElement("button");
  closeButton.innerText = "Close";
  closeButton.classList = "btn btn-secondary me-auto";
  closeButton.addEventListener("click", () => {
    document.querySelector("#popup").style.display = "none";
  })
  const stopButton = document.createElement("button");
  stopButton.innerText = "Stop";
  stopButton.classList = "btn btn-danger me-3";
  stopButton.addEventListener("click", () => {
    window.runFlag = false;
  })
  const initButton = document.createElement("button");
  initButton.innerText = "Start";
  initButton.classList = "btn btn-primary";
  initButton.addEventListener("click", () => {
    handleStart(select0.value, select1.value, input0.value === "" ? select2.value : input0.value,
      select3.value, select4.value).catch(alert);
  });
  buttonDiv.appendChild(closeButton);
  buttonDiv.appendChild(stopButton);
  buttonDiv.appendChild(initButton);
  
  inner.appendChild(closeDiv);
  inner.appendChild(promptDiv);
  inner.appendChild(label0);
  inner.appendChild(select0);
  inner.appendChild(label1);
  inner.appendChild(select1);
  inner.appendChild(label2);
  inner.appendChild(select2);
  inner.appendChild(inputDiv0);
  inner.appendChild(label3);
  inner.appendChild(select3);
  inner.appendChild(label4);
  inner.appendChild(select4);
  inner.appendChild(labelProgress);
  inner.appendChild(progress);
  inner.appendChild(buttonDiv);
  popup.appendChild(inner);
  
  document.querySelector("body").appendChild(popup);
  
  // button to start labeling
  let root;
  const intervalId = setInterval(()=> {
    let rootClass;
    if (window.location.href.includes("https://www.pixiv.net/bookmark.php")) {
      rootClass = ".column-menu";
    } else {
      rootClass = "nav";
    }
    root = document.querySelector(rootClass);
    if (root) {
      clearInterval(intervalId);
      root.classList.add("d-flex");
      const container = document.createElement("span")
      container.classList = "flex-grow-1 d-flex justify-content-end";
      const labelButton = document.createElement("button");
      if (window.location.href.includes("en")) {
        labelButton.innerText = "Label Bookmarks";
      } else {
        labelButton.innerText = "自动添加标签 / Label Bookmarks";
      }
      labelButton.classList = "btn btn-secondary";
      labelButton.addEventListener("click" ,() => {
        document.querySelector("#popup").style.display = "flex";
      })
      container.appendChild(labelButton);
      root.appendChild(container);
    }
  }, 1000);
})();
