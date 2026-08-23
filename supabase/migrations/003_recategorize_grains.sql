-- お料理ヘルパーアプリ: カテゴリ分類の調整
-- 参考: https://www.hyponex.co.jp/yasai_daijiten/vegetables のカテゴリ分け
--       (穀物 / 果菜類 / 葉茎菜類 / 根菜類 / 果物 / キノコ類)
-- Supabaseダッシュボード > SQL Editor に、このファイルの内容をそのまま貼り付けて実行してください。

-- 表記をhyponexに合わせる(きのこ類 → キノコ類)
update ingredient_catalog set category = 'キノコ類' where category = 'きのこ類';

-- 「穀物・麺・パン」を「麺・パン」(加工品)と「穀物」(生の穀物・粉類)に分割
update ingredient_catalog set category = '麺・パン', sort_order = sort_order + 500
  where category = '穀物・麺・パン' and name in (
    '食パン', 'ロールパン', 'うどん(生麺)', 'そば(乾麺)', 'そうめん', '中華麺',
    'スパゲッティ', 'マカロニ', '春雨', '餃子の皮', '春巻きの皮', 'パン粉'
  );

update ingredient_catalog set category = '穀物'
  where category = '穀物・麺・パン';
