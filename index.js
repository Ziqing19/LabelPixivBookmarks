// ==UserScript==
// @name         Pixiv收藏夹自动标签
// @name:en      Label Pixiv Bookmarks
// @namespace    http://tampermonkey.net/
// @version      1.2
// @description  自动为Pixiv收藏夹内未分类的图片打上标签
// @description:en    A sciprt helps pixiv users to label thier untagged images in the bookmarks.
// @author       LyuShiWang(original author) Ziqing19
// @match        https://www.pixiv.net/*bookmark*
// @match        https://www.pixiv.net/*users/*/bookmarks/*
// @license      MIT
// @grant        none
// ==/UserScript==
 
(function() {
    const current_url = window.location.href;
    // Confirm to start label
    if (current_url === "https://www.pixiv.net/bookmark.php?untagged=1" ||
        current_url === "https://www.pixiv.net/novel/bookmark.php?tag=&untagged=1") {
        window.addEventListener("load", () => {
            if (confirm("是否开始整理？\nStart Labeling?")) {
                window.location.href += "&rest=show&p=1";
            }
        })
    }
    // Continue
    else if (current_url === "https://www.pixiv.net/bookmark.php?type=illust_all&p=1") {
        window.location.href = "https://www.pixiv.net/bookmark.php?untagged=1&rest=show&p=1";
    }
    // Novel continue
    else if (current_url === "https://www.pixiv.net/novel/bookmark.php?tag=&rest=show&p=1&untagged=1") {
        window.location.href = "https://www.pixiv.net/novel/bookmark.php?tag=&untagged=1&rest=show&p=1";
    }
    // Add labels
    else if (current_url.indexOf("bookmark_add") > -1) {
        window.addEventListener("load", () => {
            // Get user labels
            let user_tags = []
            let tag_lists = document.getElementsByClassName('tag-cloud')[1].childNodes;
            for (let i = 0; i < tag_lists.length; i++) {
                user_tags.push(tag_lists[i].innerText);
            }
            // Get image tags
            let image_tags = document.getElementsByClassName('recommend-tag')[0].childNodes[1].childNodes;
            let tag_set = [];
            for (let i = image_tags.length - 1; i >= 0; i--) {
                let string_tag = image_tags[i].innerText;
 
                let first = string_tag.indexOf("*");
                let second = string_tag.indexOf("users");
                if (second == -1) {
                    if (first == 0) {
                        string_tag = string_tag.substring(1);
                    }
                    // Add the first tag if there is not any match
                    if (user_tags.indexOf(string_tag) > -1 || i === 0 && tag_set.lenght === 0) {
                        tag_set += string_tag + " ";
                    }
                }
            }
            if (tag_set.indexOf("R-18") === -1) {
                tag_set += "SAFE ";
            }
            tag_set = tag_set.substring(0, tag_set.length - 1);
            // Fill in the tags
            let input_box = document.getElementsByClassName("input-box tags")[0].firstElementChild;
            input_box.value = tag_set;
            let button_submit = document.getElementsByClassName('_button-large')[0];
            button_submit.click();
        })
    }
    // Select first available edit link
    else if (current_url.indexOf("untagged=1") > -1) {
        let edit_icons = document.getElementsByClassName("gtm-old_bookmark-edit_bookmark");
        if (edit_icons.length > 0) {
            for (let i = 0; i < edit_icons.length; i++) {
                let edit_icon = edit_icons[i];
                window.location.href = edit_icon.href;
                break;
            }
        } else {
            alert("全部处理完毕！\nAll images have been labeled!");
        }
    }
    // new UI
    else if (current_url.indexOf("%E6%9C%AA%E5%88%86%E9%A1%9E") > -1) {
        let urls;
        let count = 0;
        let id = setInterval(function getImages() {
            urls = document.getElementsByClassName('cdtm3u-3 eqNCoB');
            count++;
            if (urls.length !== 0) {
                clearInterval(id);
                const url = urls[0];
                window.location.href = url;
            }
            if (count === 5) {
                alert("全部处理完毕！\nAll images have been labeled!");
            }
        }, 500);
    }
    // new UI repeat
    else if (current_url.indexOf("/bookmarks/") > -1) {
        window.location.href += "/%E6%9C%AA%E5%88%86%E9%A1%9E";
    }
})();
