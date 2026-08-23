-- お料理ヘルパーアプリ: 食材削除のリアルタイム反映を修正
-- デフォルトのREPLICA IDENTITYではDELETEイベントの旧レコードに主キー(id)しか
-- 含まれず、Realtimeのfilter(group_id=eq.〜)が評価できず配信されないため、
-- 削除しても(自分の画面も含めて)手動更新するまで消えなかった。
-- FULLに変更し、旧レコードの全カラムをDELETEイベントに含めるようにする。
-- Supabaseダッシュボード > SQL Editor に、このファイルの内容をそのまま貼り付けて実行してください。

alter table ingredients replica identity full;
