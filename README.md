# Tinderプロフィール自動判定

PCは `tinder-auto-like` の全体をTinderを開いたブラウザのConsoleへ貼り付けます。
iPhoneは `tinder-auto-like-iphone.js` の全体を、Safari Webページを入力とするショートカットの「WebページでJavaScriptを実行」へ貼り付けます。繰り返しと待機の設定はファイル冒頭を参照してください。

どちらのファイルも両方の実行方式に対応します。既存のファイル別設定を維持しているため、NGキーワードとPC実行時の間隔は異なります。iPhoneの実行間隔はショートカット側の待機で決まります。

## 継続・保留の動作

- 人数上限による自動停止はありません。iPhoneの実行はショートカットで指定した繰り返し回数までです。
- 同じプロフィールを続けてクリックしません。別IDの表示で待機を解除します。再表示された相手にも現在の距離・NG条件を適用します。
- クリック後15秒経っても切り替わらなければ、別カテゴリへの移動を試みます。移動をクリックした後も、別IDが表示されるまでカテゴリを再クリックしません。
- 移動先がない場合や遷移が完了しない場合は監視を続けます。手動で別プロフィールに移動すると、次回の実行で再開できます。
- 認証要求・制限・警告・未知のダイアログを検出した場合は操作を保留します。画面が解消されれば自動で処理を再開します。
- 「Likeをアップグレードしよう！」画面の「結構です」は一度だけ押します。その他の未知のボタンは押しません。

画面の判定は表示テキスト・一般的なダイアログ属性・既知の認証iframeに基づきます。表示文言やDOMの変更によっては検出できない、または保留が続く可能性があります。実際のTinder画面での動作確認やBAN回避を保証するものではありません。

## PCの操作と状態確認

```js
tinderAutoJudge.status()
tinderAutoJudge.stop()
tinderAutoJudge.start()
tinderAutoJudge.resetHistory()
```

`status()`とiPhoneのJSON返却値には次の情報が含まれます。

| フィールド | 意味 |
| --- | --- |
| `decisionCount` | Like/Nopeのクリックを発行した回数。サーバーの受付成功件数ではありません |
| `holdReason` | 保留理由。通常時は `null` |
| `pendingProfileId` | 遷移を待っている操作元のプロフィールID。取得できない場合は `null` |
| `pendingAction` | `Like`、`Nope`、`open`、`category`、または `null` |
| `elapsedMs` | 待機中の操作からの経過ミリ秒。カテゴリ移動待ちではカテゴリクリックから計測 |

`holdReason`の主な値は `profile-transition`、`category-transition`、`profile-open-transition`、`verification-required`、`account-restricted`、`account-warning`、`like-limit`、`unknown-dialog` です。監視中はPCの `running` は `true` のままです。

件数と直近100件のログは経過時間では消去しません。PCではコードの再投入時に初期化し、iPhoneではタブのセッション内で継続します。コードの再投入、停止・再開、`resetHistory()`でも再クリック防止状態は保持します。`resetHistory()`は判定履歴・件数・カテゴリ内の巡回履歴を消去し、既存ログは保持します。

状態はタブの `sessionStorage` に保存します。複数タブ間の重複操作防止には対応していないため、実行するタブは1つにしてください。

## 検証

Node.js 22で、ネットワークや実アカウントを使わない模擬DOMの回帰テストを実行できます。

```sh
node --test tests/stability.test.cjs
node --check tinder-auto-like
node --check tinder-auto-like-iphone.js
```
