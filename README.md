# LabelPixivBookmark
A JS sciprt helps pixiv users to label thier untagged images in the bookmark.

## Usage

- Click [**uncategorized**](https://www.pixiv.net/bookmark.php?untagged=1) in **Your Bookmarks** to initiate the script
- Confirm the prompt then it will start
- Disable the Tampermonkey extension to suspend the script. Enable it and refresh the page to resume.

## Notice

- The script will detect **your existing bookmark tags** and tags of the image, and only add label for those who match
- Therefore it is suggested that users may add several custom bookmark tags before using the script, or pause to add more labels whiling running the script
- The first tag will be added by default if there is not any match
- A **SAFE** tag will be automatically added for non R-18 images

## Copyright and contact

MIT license will be used for this script.

The idea of the script and part of the code come from `https://greasyfork.org/en/users/150919-lyushiwang`, which is out-dated and without maintanence.

Please report bugs or new features expected at [Github](https://github.com/Ziqing19/LabelPixivBookmarks).


# Pixiv收藏夹自动标签
自动为Pixiv收藏夹内未分类的图片打上标签。

## 使用说明

- 在**你的收藏**页面下点击[**未分类**](https://www.pixiv.net/bookmark.php?untagged=1)，进入未分类页面。
- 浏览器弹出提示框确认后开始自动整理。
- 关闭油猴插件即可停止脚本，重新开启脚本并刷新页面后恢复自动整理

## 注意事项

- 脚本会比对图片自带的标签，以及**用户收藏的标签**，然后为图片打上能够匹配的tag（也可以自己改成添加所有图片标签，但会导致收藏大量的标签）
- 因此在启动脚本前请提前收藏好一定数量的标签，或在运行时随时暂停手动添加收藏的标签
- 如果没有匹配的标签，脚本将会自动添加第一个标签
- 脚本会自动为非R-18图片打上**SAFE**标签，方便后期筛选

## 版权与联络方式

本脚本使用MIT许可证，思路与部分代码来自`https://greasyfork.org/en/users/150919-lyushiwang`，因为上述项目暂停维护无法使用因此进行更新。Bug与新功能需求请在[Github](https://github.com/Ziqing19/LabelPixivBookmarks)进行提交。
