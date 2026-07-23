# FOOTBALL NINE LEAGUE (FNL) - Mobile Portal

公式eFootballリーグ「Football Nine League」の全9チーム向けモバイルウェブポータル

## 📁 プロジェクト構造

```
FOOTBALL-NINE-LEAGUE/
├── public/
│   └── index.html              # ✅ メインアプリケーション（コードはここに書く）
├── src/                        # 今後の拡張用
├── package.json
├── .gitignore
└── README.md
```

## 🚀 クイックスタート

### ローカル実行

```bash
# Python サーバーで起動（ポート 8000）
python3 -m http.server 8000 --directory ./public

# または npm を使用
npm start
```

ブラウザで `http://localhost:8000` にアクセス

## 📝 コードを書く場所

### **メインコード** → [public/index.html](public/index.html)

このファイルは **Single Page Application** で、以下が全て含まれています：

- **HTML構造**: ヘッダー、ナビゲーションバー、6つのページ
- **スタイル**: CSSカスタム変数で統一された配色スキーム
- **JavaScript**: UI制御、データ管理、Firebase連携

### コード領域の分け方

| 領域 | 位置 | 用途 |
|------|------|------|
| **HTML マークアップ** | `<header>` ～ `<nav>` | ページレイアウト |
| **CSS スタイル** | `<style>` タグ | デザイン・レイアウト |
| **JavaScript ロジック** | `<script>` タグ（最初） | UI制御・状態管理 |
| **Firebase 連携** | `<script type="module">` | クラウド同期 |

## 🎯 ページ一覧

1. **HOME** - リーグハイライト・最新ニュース
2. **LEAGUE TABLE (順位表)** - 順位・成績表
3. **FIXTURES & RESULTS (日程・結果)** - 全18節の試合結果
4. **CLUBS (チーム)** - 9チーム一覧
5. **NEWS (ニュース)** - 公式ニュース投稿
6. **LEAGUE REGULATIONS (規約)** - リーグルール

## 🔧 主要機能

### データ管理
- **状態管理**: `state` オブジェクトで試合結果・ニュース管理
- **クラウド同期**: Firebase Firestore でリアルタイム更新
- **ローカルキャッシュ**: 順位表の計算結果をキャッシュ

### スコア入力フロー
1. マッチカードの「✏️ 結果入力・更新」をタップ
2. ホーム・アウェイのスコア入力
3. 「保存して全員に同期」で即座にクラウド反映

### LINE 共有機能
- 順位表をテキスト形式でコピー
- 試合結果を LINE に貼り付け可能
- Web Share API に対応

## 🏗️ 開発時の編集方法

### CSS をカスタマイズする場合
`<style>` タグ内のCSS変数を編集：
```css
:root {
  --accent-gold: #c6a664;      /* メインカラー */
  --bg-body: #08090c;          /* 背景色 */
}
```

### ロジックを追加する場合
`<script>` タグの最後に関数を追加：
```javascript
// 新しい機能を追加
window.myNewFunction = function() {
  // ここにコードを書く
};
```

### Firebase 設定を変更する場合
`<script type="module">` 内の `firebaseConfig` を編集

## 📱 モバイル対応

- SafeArea対応（ノッチ対応）
- タッチ最適化UI
- 通信速度を考慮した軽量設計
- iOS/Android 両対応

## 🎨 デザイン要素

- **配色**: ゴールド（#c6a664）・シアン・グリーン
- **フォント**: Teko（ロゴ）、Noto Sans JP（本文）
- **グラデーション**: SVGシールド・サークルバッジ

## 🔐 セキュリティ

- HTML エスケープで XSS 対策
- Firebase Authentication
- クラウドへの自動同期

## 📄 ライセンス

MIT License