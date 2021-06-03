# Automatically add existing labels for images in the bookmarks

## Intro

- The script will compare **your existing bookmark tags** and tags of the image, then find the intersection and save

- If there is no match, the first tag of the image will be added (configurable now)

- It is implemented by Pixiv Web APIs, and they would be outdated someday. Please start an issue at Github.

## Usage

- It is suggested that users may add several custom bookmark tags before using the script. Or you may want to use the "add the first tag" function for cold start

- Users could find the "Label Bookmarks" button on their dashboard or bookmark page

- The script is now configurable. Here are some explanations:
  - Whether the first tag will be added if there is not any match
    - If you do not have labeled any artworks, it is recommended to choose "Yes"
    - It works when the intersection of your existing bookmark tags and tags of the work is empty, then the first tag of the image will be added
    - It is designed for a cold start. If you want to leave some of them uncategorized, choose No instead
  - Whether the "SAFE" tag will be added to non-R18 works
    - It is obvious that this function is for figuring out those SFW images
    - Choose No if you don't want the SAFE tag
  - Auto Labeling For
    - By default, the script does labeling for those uncategorized works
    - You may want to re-label all your favorite artworks when some newly-added labels were not applied to those former images
    - Choose "All Works" in this case
    - And You are free to assign a specific tag for labeling. Note that the tag is usually a Japanese word.
  - Whether the bookmark comment will be retained? 
    - On the edit bookmark page it is allowed to add some comments for this bookmark
    - By default, the comment is ignored. But if you have used this comment function before, you can still retain it by choosing "Yes"
    - Fetching those comments will take extra efforts and may reduce the performance
  - Publication Type for Labeling
    - Pixiv stores public and private bookmarks in different places, and they have independent tags
    - By default, the script only does labeling for public bookmarks

## FAQ

- The "Label Bookmarks" button cannot be found on the website
  - Firstly make sure that you are at the correct place
  - Generally, the path should be like https://www.pixiv.net/users/{YOUR UID}/bookmarks/artworks or https://www.pixiv.net/bookmark.php
  - If the path is fine and the button is still lost, it is probably because Pixiv updates its UI. Inform me at Github by starting an issue

- The script cannot work and alert a prompt
  - Please take down the prompt and start an issue at Github. The problem can be specific

- Whether Pixiv will ban my account for the script
  - The script is basically for self-use and I have limited the speed of sending requests. It works properly on thousands of images.


## Copyright and contact

MIT license will be used for this script.

The idea of the script and part of the code comes from `https://greasyfork.org/en/users/150919-lyushiwang`, which is outdated and without maintenance.

Please report bugs or new features expected at [Github](https://github.com/Ziqing19/LabelPixivBookmarks).


# 自动为Pixiv收藏夹内图片打上已有的标签

## 工作原理

- 脚本会比对作品自带的标签，以及**用户已收藏的标签**，然后为作品打上匹配的标签

- 如果已收藏标签与作品自带标签没有交集，将会自动添加第一个标签（可配置）

- 本脚本使用Pixiv的网页API进行操作，可能会出现API过时等情况，如果出现错误请在Github提交issue

## 使用说明

- 在使用脚本前，推荐提前收藏一些标签用于分类。或者可以使用自动添加首个标签功能完成冷启动

- 开启脚本后，进入个人主页/收藏后找到“自动添加标签”按钮

- 可以对脚本进行配置，下面进行简单的说明：
  - 无匹配时是否自动添加首个标签
    - 如果用户之前没有为收藏的作品添加过标签，建议选“是”
    - 作用为当该作品的标签与已收藏的标签**没有交集**时，默认添加该作品的第一个标签
  - 是否为非R18作品自动添加"SAFE"标签
    - 如字面意思，如果需要挑出全年龄向内容的作品，建议选“是”
  - 自动标签范围
    - 脚本的工作范围，默认为对“未分类作品”进行自动标签
    - 如果要自定义标签，请确保标签的名称输入正确（通常为日文标签，推荐直接从网页上复制）
  - 是否保留收藏评论
    - 参见编辑收藏的详情页，pixiv允许用户对收藏的作品进行备注评论
    - 默认为舍弃，如果您使用过收藏评论功能，请选择“保留”（需要额外的获取评论详情的操作，可能会降低性能）
  - 作品公开类型
    - pixiv的公开和非公开作品使用两套不同的收藏体系，标签列表也是独立的
    - 默认为对公开收藏的作品进行自动标签

## 常见问题

- 网页上找不到“自动添加标签”按钮
  - 请确认当前是否在个人主页或收藏夹页，网址通常为https://www.pixiv.net/users/{用户UID}/bookmarks/artworks或https://www.pixiv.net/bookmark.php
  - 如果当前路径无误依然无法找到按钮，可能为Pixiv更新了网页UI，请于Github提交issue

- 无法正常运行，弹窗提示错误
  - 请记录下弹窗提示内容，并在Github提交issue，通常具体问题需要具体分析

- 使用该脚本是否会导致封号？
  - 该脚本为作者方便分类的自用脚本，并且限制了提交速度，在千数量级的工作量下暂时没有出现问题
  - 如果对脚本不放心可以一次只提交100个，然后停止脚本，过一段时间再重复启动

## 版权与联络方式

本脚本使用MIT许可证，思路与部分代码来自`https://greasyfork.org/en/users/150919-lyushiwang`，因为上述项目暂停维护无法使用因此进行更新。Bug与新功能需求请在[Github](https://github.com/Ziqing19/LabelPixivBookmarks)进行提交。
