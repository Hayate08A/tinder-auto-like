/*
 * Tinderプロフィール自動判定（iPhone・PC共通）
 *
 * iPhoneショートカット:
 * 1. 「40回繰り返す」を追加
 * 2. 繰り返し内の「WebページでJavaScriptを実行」に
 *    このファイル全体を貼り付ける
 * 3. 入力を「ショートカットの入力（Safari Webページ）」に指定
 * 4. JavaScriptの直後に「0.5秒待機」を追加
 *
 * PC:
 * Tinderを開いたブラウザのConsoleへ、このファイル全体を貼り付ける。
 * 設定した間隔で判定を続ける。停止は tinderAutoJudge.stop() で行う。
 *
 * PC操作:
 * tinderAutoJudge.status()       状態確認
 * tinderAutoJudge.stop()         停止
 * tinderAutoJudge.start()        再開
 * tinderAutoJudge.resetHistory() 判定済み履歴の消去
 */

(() => {
  const CONFIG = Object.freeze({
    maxDistanceKm: 300,
    ngKeywords: [
      "男の娘",
      "ゲイ",
      "ホモ",
      "らいん",
      "ら い ん",
      "ら-い-ん",
      "ライン",
      "ラ-イ-ン ",
      "ラ イ ン",
    ],
    blockLineMentions: false,
    intervalMs: 3500,
    profileOpenFallbackAfterMs: 5000,
    profileLoadingRotationThreshold: 5,
    transitionWaitMs: 15000,
  });

  const STORAGE = Object.freeze({
    seen: "tinderAutoJudge.seenProfiles",
    decisions: "tinderAutoJudge.currentRunDecisions",
    log: "tinderAutoJudge.currentRunLog",
    lastStepAt: "tinderAutoJudge.lastStepAt",
    runtime: "tinderAutoJudge.runtime.v1",
  });

  const DISTANCE_PATTERN = /^(\d[\d,]*(?:\.\d+)?)\s*km\s*先$/i;

  const OBFUSCATION_SEPARATOR_PATTERN = /[\p{P}\p{S}\p{Z}\p{Cf}\s_ー]+/gu;

  const LATIN_LINE_PATTERN =
    /(?:^|[^a-z0-9])l[\p{P}\p{S}\p{Z}\p{Cf}\s_]*i[\p{P}\p{S}\p{Z}\p{Cf}\s_]*n[\p{P}\p{S}\p{Z}\p{Cf}\s_]*e(?=$|[^a-z0-9])/iu;

  const SMALL_HIRAGANA_MAP = Object.freeze({
    ぁ: "あ",
    ぃ: "い",
    ぅ: "う",
    ぇ: "え",
    ぉ: "お",
    っ: "つ",
    ゃ: "や",
    ゅ: "ゆ",
    ょ: "よ",
    ゎ: "わ",
  });

  function normalizeText(value) {
    return String(value ?? "")
      .normalize("NFKC")
      .toLocaleLowerCase("ja-JP")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function katakanaToHiragana(value) {
    return value.replace(/[\u30A1-\u30F6]/g, (character) =>
      String.fromCharCode(character.charCodeAt(0) - 0x60),
    );
  }

  function normalizeKanaForObfuscatedMatching(value) {
    return katakanaToHiragana(normalizeText(value))
      .replace(
        /[ぁぃぅぇぉっゃゅょゎ]/g,
        (character) => SMALL_HIRAGANA_MAP[character] || character,
      )
      .replace(OBFUSCATION_SEPARATOR_PATTERN, "");
  }

  function containsLineMention(value) {
    const normalized = normalizeText(value);
    const normalizedKana = normalizeKanaForObfuscatedMatching(normalized);
    const normalizedKanaWithoutOnline = normalizedKana.replace(
      /おんらいん/g,
      "",
    );

    return (
      normalizedKanaWithoutOnline.includes("らいん") ||
      LATIN_LINE_PATTERN.test(normalized)
    );
  }

  function parseDistanceTexts(values) {
    const distances = [];

    for (const value of values) {
      const match = normalizeText(value).match(DISTANCE_PATTERN);
      if (!match) continue;

      const distance = Number(match[1].replaceAll(",", ""));
      if (Number.isFinite(distance)) distances.push(distance);
    }

    return [...new Set(distances)];
  }

  function evaluateRules({
    profileText,
    distanceKm,
    maxDistanceKm = CONFIG.maxDistanceKm,
    ngKeywords = CONFIG.ngKeywords,
    blockLineMentions = CONFIG.blockLineMentions,
  }) {
    const normalizedProfile = normalizeText(profileText);
    const lineMentionDetected = containsLineMention(profileText);
    const reasons = [];

    if (distanceKm !== null && distanceKm >= maxDistanceKm) {
      reasons.push({
        type: "distance",
        value: distanceKm,
        message: `${distanceKm}km先（${maxDistanceKm}km以上）`,
      });
    }

    for (const keyword of ngKeywords) {
      const normalizedKeyword = normalizeText(keyword);

      if (normalizedKeyword && normalizedProfile.includes(normalizedKeyword)) {
        reasons.push({
          type: "keyword",
          value: keyword,
          message: `NG文字列「${keyword}」`,
        });
      }
    }

    if (blockLineMentions && lineMentionDetected) {
      reasons.push({
        type: "line",
        message: "LINEへの言及",
      });
    }

    return {
      action: reasons.length > 0 ? "Nope" : "Like",
      reasons,
      lineMentionDetected,
    };
  }

  function formatNopeReason(reason) {
    if (reason.type === "distance") {
      return `判定距離外（${reason.message}）`;
    }

    if (reason.type === "line") {
      return "LINE誘導";
    }

    return reason.message;
  }

  function createLineMentionProfileLog({
    profileId,
    profileName,
    profileText,
    distanceKm,
  }) {
    return {
      profileId,
      profileName,
      distanceKm,
      profileText,
      capturedAt: new Date().toISOString(),
    };
  }

  function createDecisionLogFields({
    action,
    profileName,
    distanceKm,
    reasonLabels,
  }) {
    const isLike = action === "Like";
    const emoji = isLike ? "❤️" : "❌";
    const displayAction = isLike ? "LIKE" : "NOPE";
    const normalizedReasons = reasonLabels.length > 0 ? reasonLabels : ["なし"];
    const distanceLabel =
      distanceKm === null || distanceKm === undefined
        ? "距離不明"
        : `${distanceKm}km`;
    const summary =
      `${emoji} ${displayAction}｜${profileName}｜${distanceLabel}｜` +
      `理由: ${normalizedReasons.join("・")}`;

    return {
      emoji,
      displayAction,
      reasonLabels: normalizedReasons,
      summary,
      message: summary,
    };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      CONFIG,
      normalizeText,
      normalizeKanaForObfuscatedMatching,
      containsLineMention,
      parseDistanceTexts,
      evaluateRules,
    };
  }

  if (typeof document === "undefined") return;

  let runtime;
  const EXPLORE_SECTION_HEADING = "出会いの目的が似ている人を探そう";

  function isSuppressed(element) {
    return Boolean(
      element.closest('[aria-hidden="true"], [hidden], [inert], .Hidden, script, style'),
    );
  }

  function readJsonArray(key) {
    try {
      const value = JSON.parse(sessionStorage.getItem(key) || "[]");
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  function readSeenProfiles() {
    const sessionProfiles = readJsonArray(STORAGE.seen);

    try {
      const localValue = JSON.parse(localStorage.getItem(STORAGE.seen) || "[]");
      const localProfiles = Array.isArray(localValue) ? localValue : [];
      const mergedProfiles = [
        ...new Set([...localProfiles, ...sessionProfiles]),
      ];

      localStorage.setItem(STORAGE.seen, JSON.stringify(mergedProfiles));
      sessionStorage.removeItem(STORAGE.seen);
      return mergedProfiles;
    } catch {
      return sessionProfiles;
    }
  }

  function writeSeenProfiles(profiles) {
    const serialized = JSON.stringify([...profiles]);

    try {
      localStorage.setItem(STORAGE.seen, serialized);
      sessionStorage.removeItem(STORAGE.seen);
    } catch {
      sessionStorage.setItem(STORAGE.seen, serialized);
    }
  }

  function resetCurrentRun() {
    sessionStorage.setItem(STORAGE.decisions, "0");
    sessionStorage.setItem(STORAGE.log, "[]");
    sessionStorage.setItem(STORAGE.lastStepAt, String(Date.now()));
  }

  function ensureCurrentRun() {
    if (sessionStorage.getItem(STORAGE.decisions) === null) {
      sessionStorage.setItem(STORAGE.decisions, "0");
    }
    if (sessionStorage.getItem(STORAGE.log) === null) {
      sessionStorage.setItem(STORAGE.log, "[]");
    }
    sessionStorage.setItem(STORAGE.lastStepAt, String(Date.now()));
  }

  function readRuntime() {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE.runtime) || "null");
    return {
      pendingDecision: null,
      pendingCategory: null,
      pendingOpen: null,
      dismissPending: false,
      missingSince: null,
      loadingCount: 0,
      nextCategoryIndex: 0,
      categoryIds: [],
      holdReason: null,
      ...saved,
    };
  }

  function saveRuntime() {
    sessionStorage.setItem(STORAGE.runtime, JSON.stringify(runtime));
  }

  function runtimeStatus() {
    const pending = runtime.pendingCategory || runtime.pendingDecision || runtime.pendingOpen;
    return {
      holdReason: runtime.holdReason,
      pendingProfileId: pending?.profileId ?? null,
      pendingAction: pending?.action ?? null,
      elapsedMs: pending ? Math.max(0, Date.now() - pending.clickedAt) : 0,
    };
  }

  function isRendered(element) {
    if (!element || isSuppressed(element)) return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" &&
      style.visibility !== "collapse" && rect.width > 0 && rect.height > 0;
  }

  function getOpenedProfile() {
    return [...document.querySelectorAll("main .profileContent")].find(isRendered) || null;
  }

  function getDisplayedProfileId() {
    const profile = getOpenedProfile() || document.querySelector('main [aria-label="プロフィールカード"]');
    return profile && isRendered(profile) ? getProfileId(profile) : null;
  }

  function hasDetailMarkers(profile) {
    const markers = new Set(["基本情報", "求めるものは"]);

    return [...profile.querySelectorAll("h1, h2, h3")]
      .filter((element) => !isSuppressed(element))
      .some((element) => markers.has(element.textContent.trim()));
  }

  function getProfileId(profile) {
    const photos = [...profile.querySelectorAll('[style*="background-image"]')];

    for (const photo of photos) {
      const backgroundImage = photo.style.backgroundImage || "";
      const match = backgroundImage.match(/\/u\/([^/)"?]+)/);

      if (match) return match[1];
    }

    return null;
  }

  function getProfileName(profile) {
    return (
      profile
        .querySelector("h1[aria-label]")
        ?.getAttribute("aria-label")
        ?.replace(/\s+\d+歳$/, "")
        .trim() ||
      profile.querySelector("h1 span")?.textContent.trim() ||
      "不明"
    );
  }

  function getProfileText(profile) {
    const texts = [];
    const walker = document.createTreeWalker(profile, NodeFilter.SHOW_TEXT);

    let node;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      if (!parent || isSuppressed(parent)) continue;

      const text = normalizeText(node.nodeValue);
      if (text) texts.push(text);
    }

    return texts.join(" ");
  }

  function getDistances(profile) {
    const values = [...profile.querySelectorAll("div, span, p, li")]
      .filter(
        (element) => element.children.length === 0 && !isSuppressed(element),
      )
      .map((element) => element.textContent);

    return parseDistanceTexts(values);
  }

  function isEnabledActionElement(element) {
    return Boolean(
      element &&
      !element.disabled &&
      element.getAttribute("aria-disabled") !== "true" &&
      isRendered(element),
    );
  }

  function findButton(labelText) {
    const expectedLabel = normalizeText(labelText);
    const root = document.querySelector("main");
    if (!root) return null;

    for (const button of root.querySelectorAll('button, [role="button"]')) {
      const names = [
        button.getAttribute("aria-label"),
        button.getAttribute("title"),
        button.textContent,
      ]
        .map(normalizeText)
        .filter(Boolean);

      if (names.includes(expectedLabel) && isEnabledActionElement(button)) {
        return button;
      }
    }

    for (const label of root.querySelectorAll("span.Hidden")) {
      if (normalizeText(label.textContent) !== expectedLabel) continue;

      const actionElement =
        label.closest('button, [role="button"]') ||
        (expectedLabel === normalizeText("プロフィールを開く")
          ? label.parentElement
          : null);

      if (isEnabledActionElement(actionElement)) return actionElement;
    }

    return null;
  }

  function clearProfileOpenFallbackState() {
    runtime.missingSince = null;
    runtime.loadingCount = 0;
  }

  function getExploreCategoryButtons() {
    const expectedHeading = normalizeText(EXPLORE_SECTION_HEADING);
    const heading = [
      ...document.querySelectorAll("nav #catalog-page span"),
    ].find((element) => normalizeText(element.textContent) === expectedHeading);
    const section = heading?.closest("section");

    if (!section) return [];

    return [...section.querySelectorAll("button[aria-label]")].filter(
      (button) => isEnabledActionElement(button),
    );
  }

  function getExploreCategoryLabel(button) {
    const heading = button.querySelector("h3");
    if (heading && normalizeText(heading.textContent)) {
      return heading.textContent.trim();
    }

    return String(button.getAttribute("aria-label") || "")
      .replace(/\s+-\s+.*$/, "")
      .trim();
  }

  function clickNextExploreCategory() {
    if (runtime.pendingCategory) return null;
    const buttons = getExploreCategoryButtons();
    if (buttons.length === 0) return null;

    runtime.nextCategoryIndex %= buttons.length;

    for (let attempt = 0; attempt < buttons.length; attempt += 1) {
      const button = buttons[runtime.nextCategoryIndex];
      runtime.nextCategoryIndex =
        (runtime.nextCategoryIndex + 1) % buttons.length;

      if (["page", "true"].includes(button.getAttribute("aria-current")) ||
          button.getAttribute("aria-selected") === "true") continue;

      const categoryLabel = getExploreCategoryLabel(button);
      if (!categoryLabel) continue;
      runtime.pendingCategory = {
        profileId: getDisplayedProfileId() || runtime.pendingDecision?.profileId || runtime.pendingOpen?.profileId || null,
        action: "category",
        categoryLabel,
        clickedAt: Date.now(),
      };
      saveRuntime();
      button.click();
      return categoryLabel;
    }

    return null;
  }

  function handleMissingProfileOpenButton(decisionCount) {
    const now = Date.now();

    if (runtime.missingSince === null) {
      runtime.missingSince = now;
    }

    const waitingMs = now - runtime.missingSince;
    const tinderIsLoading = Boolean(
      document.querySelector(
        'main [aria-label="プロフィールカード"] [aria-busy="true"]',
      ),
    );

    if (tinderIsLoading) {
      runtime.loadingCount += 1;

      if (
        runtime.loadingCount >= CONFIG.profileLoadingRotationThreshold
      ) {
        const loadingConsecutiveCount = runtime.loadingCount;
        const clickedCategory = clickNextExploreCategory();

        if (clickedCategory) {
          runtime.loadingCount = 0;
          runtime.missingSince = now;

          return {
            status: "clicked-explore-category",
            message:
              `プロフィール読み込みが${loadingConsecutiveCount}回続いたため` +
              `「${clickedCategory}」へ移動を試みました`,
            clickedCategory,
            loadingConsecutiveCount,
            decisionCount,
          };
        }
      }

      return {
        status: "waiting",
        message: "Tinder側でプロフィールを読み込んでいます",
        loadingConsecutiveCount: runtime.loadingCount,
        waitingMs,
        decisionCount,
      };
    }

    runtime.loadingCount = 0;

    if (waitingMs >= CONFIG.profileOpenFallbackAfterMs) {
      const clickedCategory = clickNextExploreCategory();

      if (clickedCategory) {
        runtime.missingSince = now;

        return {
          status: "clicked-explore-category",
          message:
            `プロフィール操作が${Math.round(waitingMs / 1000)}秒見つからないため` +
            `「${clickedCategory}」へ移動を試みました`,
          trigger: "missing-profile-open-button",
          clickedCategory,
          waitingMs,
          decisionCount,
        };
      }
    }

    return {
      status: "waiting",
      message: "操作可能な「プロフィールを開く」が見つかりません",
      waitingMs,
      decisionCount,
    };
  }

  function getBlockingUi() {
    const dialogs = [...document.querySelectorAll(
      '[role="dialog"], [aria-modal="true"], dialog[open]',
    )].filter(isRendered);
    const restrictions = [
      ["verification-required", /captcha|verify (?:your identity|you are human|you're human|your account)|verification required|本人確認.{0,20}(?:必要|行って|完了)|認証.{0,12}(?:必要|行って)|ロボットではない|人間であることを確認/i],
      ["account-restricted", /account.{0,20}(?:banned|suspended|restricted|under review)|アカウント.{0,20}(?:停止|凍結|制限|審査中)|利用.{0,8}(?:停止|制限)|アクセス.{0,8}制限/i],
      ["account-warning", /account warning|you(?:'ve| have) been warned|unusual activity|suspicious activity|不審な(?:操作|アクティビティ)|警告|コミュニティガイドライン.{0,12}違反/i],
      ["like-limit", /out of likes|no (?:more )?likes left|too many requests|try again later|like.{0,15}(?:上限|使い切)|いいね.{0,15}(?:上限|使い切)|しばらくしてから.{0,8}(?:試|再度)/i],
    ];
    // プロフィール本文・カード・ナビゲーションは警告文の検索対象にしない。
    const texts = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      if (!parent || !isRendered(parent)) continue;
      if (!parent.closest('[role="dialog"], [aria-modal="true"], dialog[open]') &&
          parent.closest('.profileContent, [aria-label="プロフィールカード"], nav')) continue;
      texts.push(node.nodeValue);
    }
    const text = normalizeText(texts.join(" "));
    for (const [reason, pattern] of restrictions) {
      if (pattern.test(text)) return { reason };
    }
    const verificationFrame = [...document.querySelectorAll("iframe")].some(
      (frame) => isRendered(frame) && /captcha|arkoselabs|funcaptcha/i.test(
        `${frame.getAttribute("src") || ""} ${frame.getAttribute("title") || ""}`,
      ),
    );
    if (verificationFrame) return { reason: "verification-required" };

    const expectedTitle = normalizeText("Likeをアップグレードしよう！");
    // 既知のダイアログに別のダイアログが重なっている場合も操作を保留する。
    if (dialogs.length === 1) {
      const dialog = dialogs[0];
      const isUpgrade = [...dialog.querySelectorAll("h1, h2, h3")].some(
        (heading) => isRendered(heading) && normalizeText(heading.textContent) === expectedTitle,
      );
      const dismissButton = isUpgrade && [...dialog.querySelectorAll("button")].find(
        (button) => isEnabledActionElement(button) &&
          normalizeText(button.textContent) === normalizeText("結構です"),
      );
      if (dismissButton) return { dismissButton };
    }
    return dialogs.length ? { reason: "unknown-dialog" } : null;
  }

  function waitingForTransition(reason, message, decisionCount) {
    return { status: "waiting", holdReason: reason, message, decisionCount };
  }

  function openProfile(button, decisionCount) {
    runtime.pendingOpen = {
      profileId: getDisplayedProfileId(), action: "open", clickedAt: Date.now(),
    };
    clearProfileOpenFallbackState();
    saveRuntime();
    button.click();
    return { status: "opened", message: "プロフィールを開きました", decisionCount };
  }

  function handlePendingTransition(profile, decisionCount) {
    const profileId = getDisplayedProfileId();
    if (profile) runtime.pendingOpen = null;
    // 消失だけでは送信完了とみなさず、別IDの表示を待つ。
    if (profileId && runtime.pendingDecision &&
        profileId !== runtime.pendingDecision.profileId) {
      runtime.pendingDecision = null;
    }
    if (profileId && runtime.pendingCategory &&
        profileId !== runtime.pendingCategory.profileId) {
      runtime.pendingCategory = null;
      runtime.pendingOpen = null;
      runtime.categoryIds = [];
    }

    // カード側にIDがない場合も、詳細を一度だけ開いて遷移を確認する。
    if (!profile && (runtime.pendingDecision || runtime.pendingCategory) && !runtime.pendingOpen) {
      const openButton = findButton("プロフィールを開く");
      if (openButton) return openProfile(openButton, decisionCount);
    }
    if (runtime.pendingCategory) {
      return waitingForTransition("category-transition", "カテゴリ移動後の別プロフィール表示を待っています", decisionCount);
    }
    const pending = runtime.pendingDecision || runtime.pendingOpen;
    if (!pending) return null;
    if (Date.now() - pending.clickedAt >= CONFIG.transitionWaitMs) {
      const clickedCategory = clickNextExploreCategory();
      if (clickedCategory) {
        return {
          status: "clicked-explore-category", clickedCategory, decisionCount,
          message: `画面遷移を15秒待ったため「${clickedCategory}」へ移動を試みました`,
        };
      }
    }
    return waitingForTransition(
      runtime.pendingDecision ? "profile-transition" : "profile-open-transition",
      "画面の更新待ちです。同じ操作は再送せず監視を続けます", decisionCount,
    );
  }

  function appendLog(entry) {
    const log = readJsonArray(STORAGE.log);
    log.push(entry);
    sessionStorage.setItem(STORAGE.log, JSON.stringify(log.slice(-100)));
  }

  function runStep() {
    try {
      runtime = readRuntime();
      ensureCurrentRun();
      const result = performStep();
      runtime.holdReason = result.holdReason ||
        (result.status === "waiting" ? "profile-not-ready" : null);
      saveRuntime();
      return { ...result, ...runtimeStatus() };
    } catch (error) {
      return {
        status: "error",
        holdReason: "execution-error",
        pendingProfileId: runtime?.pendingDecision?.profileId ?? null,
        pendingAction: runtime?.pendingDecision?.action ?? null,
        elapsedMs: runtime?.pendingDecision ? Math.max(0, Date.now() - runtime.pendingDecision.clickedAt) : 0,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  function performStep() {
    const decisionCount = Number(
      sessionStorage.getItem(STORAGE.decisions) || "0",
    );

    const blockingUi = getBlockingUi();
    if (blockingUi?.reason) {
      return {
        status: "held", holdReason: blockingUi.reason,
        message: "認証・制限・警告または未対応の画面が表示されています。解消後に自動再開します",
        decisionCount,
      };
    }
    if (blockingUi?.dismissButton) {
      if (runtime.dismissPending) {
        return waitingForTransition("dialog-transition", "アップグレード画面が閉じるのを待っています", decisionCount);
      }
      runtime.dismissPending = true;
      saveRuntime();
      blockingUi.dismissButton.click();
      return {
        status: "dismissed-like-upgrade",
        message: "Likeアップグレード画面で「結構です」を押しました", decisionCount,
      };
    }
    runtime.dismissPending = false;
    const profile = getOpenedProfile();
    const transitionResult = handlePendingTransition(profile, decisionCount);
    if (transitionResult) return transitionResult;

    // 詳細が閉じているときは、この呼び出しでは開くだけ。
    if (!profile) {
      const openButton = findButton("プロフィールを開く");

      if (!openButton) {
        return handleMissingProfileOpenButton(decisionCount);
      }

      return openProfile(openButton, decisionCount);
    }

    clearProfileOpenFallbackState();

    if (!hasDetailMarkers(profile)) {
      return {
        status: "waiting",
        message: "プロフィール詳細の読み込み待ちです",
        decisionCount,
      };
    }

    const profileId = getProfileId(profile);
    const profileName = getProfileName(profile);

    if (!profileId) {
      return {
        status: "waiting",
        message: "プロフィールIDを取得できません",
        profileName,
        decisionCount,
      };
    }

    if (runtime.categoryIds.includes(profileId)) {
      const clickedCategory = clickNextExploreCategory();
      if (clickedCategory) {
        return {
          status: "clicked-explore-category", clickedCategory, profileId, profileName, decisionCount,
          message: `プロフィールが再表示されたため「${clickedCategory}」へ移動を試みました`,
        };
      }
      runtime.categoryIds = [];
    }
    const seenProfiles = new Set(readSeenProfiles());

    const distances = getDistances(profile);

    if (distances.length > 1) {
      return {
        status: "error",
        message: "異なる距離表示が複数見つかりました",
        distances,
        profileId,
        profileName,
        decisionCount,
      };
    }

    const distanceKm = distances[0] ?? null;
    const profileText = getProfileText(profile);
    const decision = evaluateRules({
      profileText,
      distanceKm,
    });
    const button = findButton(decision.action);

    if (!button) {
      return {
        status: "waiting",
        message: `${decision.action}ボタンが見つかりません`,
        distanceKm,
        reasons: decision.reasons,
        profileId,
        profileName,
        decisionCount,
      };
    }

    const nextCount = decisionCount + 1;
    const nopeReasons = decision.reasons.map(formatNopeReason);
    const reasonLabels =
      decision.action === "Nope"
        ? nopeReasons
        : decision.lineMentionDetected
          ? ["LINE誘導あり（許可）"]
          : [];
    const result = {
      status: decision.action === "Nope" ? "clicked-nope" : "clicked-like",
      action: decision.action,
      ...createDecisionLogFields({
        action: decision.action,
        profileName,
        distanceKm,
        reasonLabels,
      }),
      distanceKm,
      reasons: decision.reasons,
      lineMentionDetected: decision.lineMentionDetected,
      ...(decision.lineMentionDetected
        ? {
            logNotes: ["LINE誘導あり（許可）"],
            lineMentionProfile: createLineMentionProfileLog({
              profileId,
              profileName,
              profileText,
              distanceKm,
            }),
          }
        : {}),
      ...(nopeReasons.length > 0 ? { nopeReasons } : {}),
      profileId,
      profileName,
      decisionCount: nextCount,
    };

    // 再送防止状態だけを先に保存する。件数・ログはclick()発行後に更新する。
    runtime.pendingDecision = { profileId, action: decision.action, clickedAt: Date.now() };
    saveRuntime();
    button.click();
    sessionStorage.setItem(STORAGE.decisions, String(nextCount));
    appendLog(result);
    seenProfiles.add(profileId);
    writeSeenProfiles(seenProfiles);
    runtime.categoryIds.push(profileId);
    return result;
  }

  const isIPhoneShortcut = typeof completion === "function";

  if (isIPhoneShortcut) {
    // ショートカットでは1ステップだけ実行し、即座に完了する。
    completion(JSON.stringify(runStep()));
    return;
  }

  // PCコンソールでは同じコードが自動反復する。
  window.tinderAutoJudge?.stop?.();
  resetCurrentRun();

  const controller = {
    timer: null,
    lastResult: null,

    start() {
      if (this.timer) return;

      const tick = () => {
        this.lastResult = runStep();

        if (this.lastResult.status !== "opened") {
          if (this.lastResult.summary) {
            console.log(
              `[Tinder Auto Judge] ${this.lastResult.summary}`,
              this.lastResult,
            );
          } else {
            console.log("[Tinder Auto Judge]", this.lastResult);
          }
        }
      };

      tick();
      this.timer = window.setInterval(tick, CONFIG.intervalMs);
    },

    stop() {
      if (this.timer) {
        window.clearInterval(this.timer);
        this.timer = null;
      }
      console.log("[Tinder Auto Judge] stopped");
    },

    status() {
      runtime = readRuntime();
      return {
        running: Boolean(this.timer),
        decisionCount: Number(sessionStorage.getItem(STORAGE.decisions) || "0"),
        seenProfiles: readSeenProfiles().length,
        lastResult: this.lastResult,
        ...runtimeStatus(),
        holdReason: this.lastResult?.holdReason ?? runtime.holdReason,
      };
    },

    resetHistory() {
      try {
        localStorage.removeItem(STORAGE.seen);
      } catch {
        // localStorageを利用できない環境ではsessionStorageのみ消去する。
      }
      sessionStorage.removeItem(STORAGE.seen);
      sessionStorage.removeItem(STORAGE.decisions);
      runtime = readRuntime();
      runtime.categoryIds = [];
      // pendingDecision / pendingCategory / pendingOpenは履歴消去でも保持する。
      saveRuntime();
      console.log("[Tinder Auto Judge] 判定済み履歴を消去しました");
    },
  };

  window.tinderAutoJudge = controller;
  controller.start();
})();
