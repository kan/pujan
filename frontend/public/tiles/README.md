# 牌の絵

牌の面の絵は [FluffyStuff/riichi-mahjong-tiles](https://github.com/FluffyStuff/riichi-mahjong-tiles) の `Regular/` の SVG です（コミット `26e127ba2117f45cdce5ea0225748cc0cfad3169`）。

- ライセンス: CC0 1.0（パブリックドメイン。`LICENSE.md` は元のリポジトリのもの）。帰属表示は求められていないが、出典としてここに残す
- 使っているのは面の絵（透明な地に絵柄）だけ。牌の地・縁・影は `frontend/src/theme.css` の `.tile` で描く（元の `Front.svg`・`Back.svg`・`Blank.svg` は入れていない）
- 元の SVG から svgo 3.3.2（`--multipass`）で Inkscape の付帯情報を取り除いた。絵柄は変えていない
- `*-Dora.svg` は赤の 5（赤牌）
