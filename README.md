# Welcome to your Lovable project

## Project info

**URL**: https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID

## How can I edit this code?

There are several ways of editing your application.

**Use Lovable**

Simply visit the [Lovable Project](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and start prompting.

Changes made via Lovable will be committed automatically to this repo.

**Use your preferred IDE**

If you want to work locally using your own IDE, you can clone this repo and push changes. Pushed changes will also be reflected in Lovable.

The only requirement is having Node.js & npm installed - [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)

Follow these steps:

```sh
# Step 1: Clone the repository using the project's Git URL.
git clone <YOUR_GIT_URL>

# Step 2: Navigate to the project directory.
cd <YOUR_PROJECT_NAME>

# Step 3: Install the necessary dependencies.
npm i

# Step 4: Start the development server with auto-reloading and an instant preview.
npm run dev
```

**Edit a file directly in GitHub**

- Navigate to the desired file(s).
- Click the "Edit" button (pencil icon) at the top right of the file view.
- Make your changes and commit the changes.

**Use GitHub Codespaces**

- Navigate to the main page of your repository.
- Click on the "Code" button (green button) near the top right.
- Select the "Codespaces" tab.
- Click on "New codespace" to launch a new Codespace environment.
- Edit files directly within the Codespace and commit and push your changes once you're done.

## What technologies are used for this project?

This project is built with:

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS

## How can I deploy this project?

Simply open [Lovable](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and click on Share -> Publish.

## Can I connect a custom domain to my Lovable project?

Yes, you can!

To connect a domain, navigate to Project > Settings > Domains and click Connect Domain.

Read more here: [Setting up a custom domain](https://docs.lovable.dev/features/custom-domain#custom-domain)

## 運用メモ：適正在庫計算

### 再計算の実行

毎月月初に以下のコマンドで適正在庫を再計算することを推奨します：

```bash
node scripts/calculate-optimal-stock.js
```

または管理画面の「適正在庫一覧」ページから「再計算」ボタンで実行できます。

### 販売タイプ（sales_type）

商品には以下の販売タイプが設定されます：

- **REGULAR（通年販売）**: デフォルト。終売自動判定の対象
- **SEASONAL（季節限定）**: 手動設定。終売判定から除外される
- **WEATHER（天候依存）**: 手動設定。終売判定から除外される
- **DISCONTINUED（終売）**: 自動判定またはは手動設定

### 終売自動判定

- REGULAR商品のみが対象（SEASONAL / WEATHER は除外）
- 過去に販売実績があり、直近3ヶ月で販売が0の場合に自動で DISCONTINUED に変更
- 終売商品は適正在庫の計算対象から除外される

### データの精度向上

2024年8月〜12月の販売データを追加インポートした後に再計算すると、月別の適正在庫の精度が向上します。
