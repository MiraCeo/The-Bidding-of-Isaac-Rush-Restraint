# 道具图片资源

调用资源只放在本目录，项目根目录不保留PNG；源文件仅移动／统一命名，像素字节不变。

| 文件 | 原文件名 | 用途 |
| --- | --- | --- |
| `collectibles-sprite.png` | `Collectibles_sprite.png` | 640×1280，20列40行，32×32道具图集 |
| `trinket-sprite.png` | `Trinket_sprite.png` | 640×320，20列10行，32×32饰品图集 |
| `grab-bag.png` | `Anm2_resources_gfx_items_pick_ups_grabbag.png` | 32×32福袋掉落物单帧 |

原文件名、尺寸与SHA256记录在 `manifest.json`，坐标与美术别名记录在 `web/lib/ui/item-art.ts`。三个资源均以 `?inline` 导入，离线包不需要附带图片目录。

新增或替换图片时同步更新清单与测试，不保留同内容的根目录副本，不更改道具ID或结算规则。
