// ==UserScript==
// @name         Pixiv收藏夹自动标签
// @name:en      Label Pixiv Bookmarks
// @namespace    http://tampermonkey.net/
// @version      2.2
// @description  自动为Pixiv收藏夹内图片打上已有的标签
// @description:en    Automatically add existing labels for images in the bookmarks
// @author       Ziqing19
// @match        https://www.pixiv.net/*users/*/bookmarks/artworks*
// @match        https://www.pixiv.net/bookmark.php*
// @icon         https://www.google.com/s2/favicons?domain=pixiv.net
// @resource     bootstrapCSS https://cdn.jsdelivr.net/npm/bootstrap@5.0.1/dist/css/bootstrap.min.css
// @resource     bootstrapJS https://cdn.jsdelivr.net/npm/bootstrap@5.0.2/dist/js/bootstrap.bundle.min.js
// @grant        GM_getResourceURL
// ==/UserScript==

function cssElement(url) {
  const link = document.createElement("link");
  link.href = url;
  link.rel="stylesheet";
  link.type="text/css";
  return link;
}

function jsElement(url) {
  const script = document.createElement("script");
  script.src = url;
  script.integrity = "sha384-MrcW6ZMFYlzcLA8Nl+NtUVF0sA7MsXsP1UyJoMp4YLEuNSfAP+JcXn/tWtIaxVXM";
  script.crossOrigin = "anonymous";
  return script;
}

const delay = ms => new Promise(res => setTimeout(res, ms));

async function handleUpdate(token, illust_id, tags, retainComment, retainTag, restricted) {
  const PIXIV_API_URL = "https://www.pixiv.net/rpc/index.php";
  const mode = "save_illust_bookmark";
  
  let comment, newTags;
  // get comment from the detailed page
  if (retainComment || retainTag) {
    const docRaw = await fetch("https://www.pixiv.net/bookmark_add.php?type=illust&illust_id=" + illust_id);
    const docRes = await docRaw.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(docRes, "text/html");
    comment = doc.querySelector("div.input-box.ui-counter").firstElementChild.value;
    const previousTags = doc.querySelector("div.input-box.tags").firstElementChild.value.trim().split(" ");
    // remove the duplicate
    newTags = Array.from(new Set(tags.concat(previousTags))).slice(0,10).join("+");
  } else {
    comment = "";
    newTags = tags.join("+");
  }
  console.log(comment, newTags);
  
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
      'tags'+(!!newTags ? `=${newTags}` : ''),
      `tt=${token}`,
    ].join('&'),
  });
}

async function handleStart(addFirst, addSAFE, tagToQuery, retainComment, retainTag, publicationType, synonymDict) {
  window.runFlag = true;
  const promptBottom = document.querySelector("#prompt");
  promptBottom.innerText = `处理中，请勿关闭窗口
  Processing. Please do not close the window.
  `;
  
  // get token
  const userRaw = await fetch("https://www.pixiv.net/bookmark_add.php?type=illust&illust_id=83540927");
  if (!userRaw.ok) {
    return alert(`获取身份信息失败
    Fail to fetch user information`);
  }
  const userRes = await userRaw.text();
  const tokenPos = userRes.indexOf("pixiv.context.token");
  const tokenEnd = userRes.indexOf(";", tokenPos);
  const token = userRes.slice(tokenPos, tokenEnd).split("\"")[1];
  console.log("token:", token);
  
  // get user uid
  const uidPos = userRes.indexOf("pixiv.user.id");
  const uidEnd = userRes.indexOf(";", uidPos);
  const uid = userRes.slice(uidPos, uidEnd).split("\"")[1];
  console.log("uid:", uid);
  
  if (!token) {
    console.log(`获取token失败
    Fail to fetch token`);
  }
  if (!uid) {
    console.log(`获取uid失败
    Fail to fetch uid`);
  }
  
  // get user tags
  const tagsRaw = await fetch("https://www.pixiv.net/ajax/user/" + uid + "/illusts/bookmark/tags");
  const tagsObj = await tagsRaw.json();
  if (!tagsRaw.ok || tagsObj.error === true) {
    return alert(`获取tags失败
    Fail to fetch user tags` + "\n" + decodeURI(tagsObj.message));
  }
  const userTagsSet = new Set();
  for (let obj of tagsObj.body.public) {
    userTagsSet.add(decodeURI(obj.tag));
  }
  for (let obj of tagsObj.body.private) {
    userTagsSet.add(decodeURI(obj.tag));
  }
  const userTags = Array.from(userTagsSet);
  console.log("userTags:", userTags);
  
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
        console.log("Progress bar stops updating");
        clearInterval(intervalId);
      }
    }
  }, 1000);
  do {
    const realOffset = tagToQuery === "未分類" ? offset : index;
    const bookmarksRaw = await fetch("https://www.pixiv.net/ajax/user/" + uid
      + "/illusts/bookmarks?tag=" + tagToQuery + "&offset="+ realOffset +"&limit=100&rest=" + publicationType);
    const bookmarksRes = await bookmarksRaw.json();
    if (!bookmarksRaw.ok || bookmarksRes.error === true) {
      return alert(`获取用户收藏夹列表失败
    Fail to fetch user bookmarks` + "\n" + decodeURI(bookmarksRes.message));
    }
    const bookmarks = bookmarksRes.body;
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
        let intersection = userTags.filter(userTag => {
          // if work tags includes this user tag
          if (workTags.includes(userTag)) return true;
          // if work tags match an user alias
          if (synonymDict[userTag]
            && synonymDict[userTag].filter(alias => workTags.includes(alias)).length > 0) return true;
          // without parody name
          const stripped = userTag.split("(")[0];
          return workTags.includes(stripped);
        });
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
          await handleUpdate(token, illust_id, intersection,
            retainComment === "true", retainTag==="true", publicationType === "show" ? 0 : 1);
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
      if (!window.runFlag) {
        promptBottom.innerText = `检测到停止信号，程序已停止运行
  Stop signal detected. Program exits.
  `;
      }
    }
  } while (index < total);
  if (total === 0) {
    promptBottom.innerText = `指定分类下暂无符合要求的作品，请关闭窗口
  Works needed to be labeled not found. Please close the window.
  `;
  } else {
    document.querySelector("#prompt").innerText = `自动添加标签已完成，请关闭窗口并刷新网页
  Auto labeling finished successfully. Please close the window and refresh.
  `;
  }
}

(function() {
  'use strict';
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
  
  const popup = document.createElement("div");
  popup.style.width = "47rem";
  popup.style.position = "fixed";
  popup.style.left = "calc(50vw - 24rem)";
  if (window.matchMedia("(min-height: 60rem)").matches) {
    popup.style.minHeight = "50rem";
    popup.style.maxHeight = "90vh";
    popup.style.top = "5vh";
  } else {
    popup.style.maxHeight = "calc(100vh - 2rem)";
    popup.style.top = "1rem";
  }
  popup.style.overflowX = "hidden";
  popup.style.background = "rgb(245,245,245)";
  popup.style.display = "none";
  popup.style.opacity = "0";
  popup.className = "py-3 px-4 rounded border border-secondary flex-column";
  popup.id = "popup";
  popup.style.transition = "opacity 0.2s ease 0s";
  
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
    popup.style.opacity = "0";
    shade.style.opacity = "0";
    setTimeout(()=> {
      popup.style.display = "none";
      shade.style.display = "none";
    }, 200);
  })
  closeDiv.appendChild(close);
  
  const promptTop = document.createElement("div");
  promptTop.className = "flex-grow-1 text-center mb-4";
  promptTop.innerHTML = `
    <div>如果对以下配置有疑惑，请参考
      <a href="https://greasyfork.org/zh-CN/scripts/423823-pixiv%E6%94%B6%E8%97%8F%E5%A4%B9%E8%87%AA%E5%8A%A8%E6%A0%87%E7%AD%BE?locale_override=1" style="text-decoration: underline">文档</a>
    </div>
    <div>Please refer to the
      <a href="https://greasyfork.org/en/scripts/423823-pixiv%E6%94%B6%E8%97%8F%E5%A4%B9%E8%87%AA%E5%8A%A8%E6%A0%87%E7%AD%BE" style="text-decoration: underline">document</a> if confused.
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
  })
  
  const inputDiv0 = document.createElement("div")
  inputDiv0.id = "input_div_0";
  inputDiv0.className = "mb-4"
  inputDiv0.style.display = "none";
  const input0 = document.createElement("input");
  input0.id = "input0";
  input0.className = "form-control"
  const labelInput0 = document.createElement("label");
  labelInput0.htmlFor = "input0";
  labelInput0.innerText = `自定义标签
  Custom Tag
  `
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
      <input class="form-control border mb-3" type="file" accept="application/json" id="synonym_dict_input" />
      <label class="form-label fw-light" for="target_tag">目标标签（用户标签） / Target Tag (User Tag)</label>
      <input class="form-control mb-3" type="text" id="target_tag">
      <label class="form-label fw-light" for="tag_alias">同义词（作品标签，空格分割） / Alias (From Artwork, Space Delimited)</label>
      <input class="form-control mb-3" type="text" id="tag_alias">
      <div class="d-flex mb-3" id="synonym_buttons">
        <button class="btn btn-outline-primary me-auto">保存 / Save Dict</button>
        <button class="btn btn-outline-primary me-3">加载标签 / Load Tag</button>
        <button class="btn btn-outline-primary">更新标签 / Update Tag</button>
      </div>
      <div class="mb-2 fw-light">预览 / Preview</div>
      <div id="synonym_preview" style="white-space: pre-wrap"/>
    </div>
  </div>
  `;
  let synonymDict = {};
  function loadSynonymEventListener() {
    const targetTag = document.querySelector("#target_tag");
    const alias = document.querySelector("#tag_alias");
    const preview = document.querySelector("#synonym_preview");
    const buttons = document.querySelector("#synonym_buttons").querySelectorAll("button");
    // update preview
    function updatePreview() {
      let synonymString = "";
      for (let key of Object.keys(synonymDict)) {
        synonymString += key + "\n\t" + synonymDict[key].join(" ") + "\n\n";
      }
      preview.innerText = synonymString;
    }
    // on json file load
    document.querySelector("#synonym_dict_input").addEventListener("change", (evt) => {
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          synonymDict = JSON.parse(evt.target.result.toString());
          updatePreview();
        } catch (err) {
          alert("无法加载词典 / Fail to load dictionary\n" + err);
        }
      }
      reader.readAsText(evt.target.files[0]);
    })
    buttons[0].addEventListener("click", (evt) => {
      evt.preventDefault();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([JSON.stringify(synonymDict)], {
        type: "application/json"
      }));
      a.setAttribute("download", "label_pixiv_bookmarks_synonym_dict.json");
      a.click();
    })
    // load alias
    buttons[1].addEventListener("click", (evt) => {
      evt.preventDefault();
      const targetValue = targetTag.value;
      for (let key of Object.keys(synonymDict)) {
        if (key === targetValue) {
          alias.value = synonymDict[key].join(" ");
          updatePreview();
        }
      }
    })
    // update the alias array
    buttons[2].addEventListener("click", (evt) => {
      evt.preventDefault();
      const targetValue = targetTag.value;
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
      updatePreview();
    });
  }
  
  const inputDiv1 = document.createElement("div")
  inputDiv1.id = "input_div_1";
  inputDiv1.className = "mb-4"
  inputDiv1.style.display = "none";
  const input1 = document.createElement("input");
  input1.id = "input1";
  input1.className = "form-control"
  const labelInput1 = document.createElement("label");
  labelInput1.htmlFor = "input1";
  labelInput1.innerText = `自定义标签
  Custom Tag
  `
  labelInput1.className = "form-label mb-3 fw-light";
  inputDiv1.appendChild(labelInput1);
  inputDiv1.appendChild(input1);
  
  const labelProgress = document.createElement("label");
  const progress = document.createElement("div");
  const progressBar = document.createElement("div");
  progress.id = "progress";
  progress.style.minHeight = "1rem";
  progress.className = "progress mb-4";
  progressBar.className = "progress-bar progress-bar-striped progress-bar-animated";
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
    popup.style.display = "none";
    shade.style.display = "none";
  })
  const stopButton = document.createElement("button");
  stopButton.innerText = "Stop";
  stopButton.className = "btn btn-danger me-3";
  stopButton.addEventListener("click", () => {
    window.runFlag = false;
  })
  const initButton = document.createElement("button");
  initButton.innerText = "Start";
  initButton.className = "btn btn-primary";
  initButton.addEventListener("click", () => {
    handleStart(select0.value, select1.value, input0.value === "" ? select2.value : input0.value,
      select3.value,select5.value, select4.value, synonymDict).catch(alert);
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
  popup.appendChild(inner);
  
  // button to start labeling
  let root;
  const intervalId = setInterval(()=> {
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
      const container = document.createElement("span")
      container.className = "flex-grow-1 d-flex justify-content-end";
      const labelButton = document.createElement("button");
      if (window.location.href.includes("en")) {
        labelButton.innerText = "Label Bookmarks";
      } else {
        labelButton.innerText = "自动添加标签 / Label Bookmarks";
      }
  
      labelButton.style.paddingRight = "24px";
      labelButton.style.paddingLeft = "24px";
      labelButton.style.background = "transparent";
      if (window.location.href.includes("https://www.pixiv.net/bookmark.php")) {
        labelButton.style.border = "none";
        labelButton.style.color = "#258fb8";
      } else {
        labelButton.className = "fw-bold";
        labelButton.style.fontSize = "16px";
        labelButton.style.borderTop = "4px solid rgba(0, 150, 250, 0)";
        labelButton.style.borderLeft = "none";
        labelButton.style.borderRight = "none";
        labelButton.style.borderBottom = "none";
        labelButton.style.color = "rgba(0, 0, 0, 0.32)";
        labelButton.style.lineHeight = "24px"
        labelButton.style.background = "transparent";
        labelButton.style.transition = "color 0.4s ease 0s, border 0.4s ease 0s";
        labelButton.addEventListener("mouseenter", () => {
          labelButton.style.borderTop = "4px solid rgb(0, 150, 250)";
          labelButton.style.color = "rgba(0, 0, 0, 0.88)";
        })
        labelButton.addEventListener("mouseleave", () => {
          labelButton.style.borderTop = "4px solid rgba(0, 150, 250, 0)";
          labelButton.style.color = "rgba(0, 0, 0, 0.32)";
        })
      }
      
      labelButton.addEventListener("click" ,() => {
        popup.style.display = "flex";
        shade.style.display = "flex";
        setTimeout(() => {
          popup.style.opacity = "1";
          shade.style.opacity = "1";
        }, 100);
      })
      container.appendChild(labelButton);
      
      shade.addEventListener("click", () => {
        popup.style.opacity = "0";
        shade.style.opacity = "0";
        setTimeout(()=> {
          popup.style.display = "none";
          shade.style.display = "none";
        }, 200);
      })
      
      const body = document.querySelector("body");
      root.appendChild(container);
      body.appendChild(shade);
      body.appendChild(popup);
      loadSynonymEventListener();
    }
  }, 1000);
})();
