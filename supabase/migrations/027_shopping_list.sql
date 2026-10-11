-- 027: 買い物リスト(常備品の買い足し)。
-- 「作った」のあとや冷蔵庫の常備品の棚で「なくなった」とマークした食材を、家の買い物リストに出す。
-- リストに入るのは利用者がマークした食材だけ(在庫が0になった食材を自動では入れない)。
-- 冷蔵庫の行(ingredients)に印を付けるだけなので、読み書きの権限は既存の ingredients の RLS(家ごと)に従う。
-- 何度実行しても同じ結果になる。既存のデータは変えない(新しい列は空)。
alter table ingredients add column if not exists restock_requested_at timestamptz;
create index if not exists idx_ingredients_restock on ingredients (group_id) where restock_requested_at is not null;
