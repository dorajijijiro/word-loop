import { useCallback, useEffect, useRef, useState, type CSSProperties, type SyntheticEvent } from 'react'
import { neutralImagePlaceholder, words, type Word } from './data/words'
import {
  advanceEncounter,
  clearReencounterQueue,
  createEncounterSession,
  registerAttention,
  retreatEncounter,
  startEncounter,
  type EncounterSession,
} from './lib/encounterEngine'
import {
  completeExpedition,
  createIdleExpedition,
  getCompletionDelayMilliseconds,
  hasReachedExpeditionLimit,
  isExpeditionRunning,
  recordExpeditionEncounter,
  returnFromExpedition,
  startExpedition,
  type ExpeditionState,
} from './lib/expedition'
import {
  getWordProgress,
  loadLearningProgress,
  recordAttention,
  recordEncounter,
  saveLearningProgress,
  type LearningProgressMap,
} from './lib/learningProgress'
import {
  loadLearningState,
  saveLearningState,
  type LearningState,
} from './lib/learningState'
import {
  applyExpeditionRewards,
  loadPlayerProgress,
  savePlayerProgress,
  type PlayerProgress,
} from './lib/playerProgress'
import { getLevelChange, getLevelProgress, type LevelProgress } from './lib/level'
import { calculateEncounterXp, getEncounterRewardKind } from './lib/rewards'
import {
  getUnderstanding,
  loadUnderstanding,
  recordUnderstanding,
  resolveUnderstandingTarget,
  saveUnderstanding,
  type UnderstandingMap,
  type UnderstandingPress,
  type UnderstandingStatus,
} from './lib/understanding'
import {
  nextRecallStep,
  recallEnabledInExpedition,
  startRecallStep,
  type RecallStep,
} from './lib/recall'
import './App.css'

const speedPresets = [
  { label: '超高速', seconds: 0.25 },
  { label: '高速', seconds: 0.5 },
  { label: '標準', seconds: 1 },
  { label: 'ゆっくり', seconds: 2 },
]

const wordIds = words.map((word) => word.id)
const wordById = new Map(words.map((word) => [word.id, word]))
// Recall Cue を持つ語だけを Recall の対象にする。
const recallWordIds = words.filter((word) => word.recallCue !== undefined).map((word) => word.id)
const attentionFeedbackMilliseconds = 1200
const understandingOptions: { status: UnderstandingStatus; label: string }[] = [
  { status: 'known', label: 'わかる' },
  { status: 'unknown', label: 'まだわからない' },
]
const getCurrentTimestamp = () => new Date().toISOString()
const progressSaveDelayMilliseconds = 1000

function App() {
  const [initialState] = useState(loadLearningState)
  const [session, setSession] = useState(() =>
    createEncounterSession(wordIds, initialState.currentWordId),
  )
  const [progress, setProgress] = useState(loadLearningProgress)
  const [attentionFeedback, setAttentionFeedback] = useState<Word | null>(null)
  const [speechEnabled, setSpeechEnabled] = useState(initialState.speechEnabled)
  const [showPhrase, setShowPhrase] = useState(initialState.showPhrase)
  const [isLooping, setIsLooping] = useState(false)
  const [intervalSeconds, setIntervalSeconds] = useState(initialState.intervalSeconds)
  const [expedition, setExpedition] = useState(createIdleExpedition)
  const [playerProgress, setPlayerProgress] = useState(loadPlayerProgress)
  const [understanding, setUnderstanding] = useState(loadUnderstanding)
  const understandingRef = useRef<UnderstandingMap>(understanding)
  // 理解度ボタンを押し始めた時点の語。高速周回で押下中に表示が変わっても、この語に記録する。
  const understandingPressRef = useRef<UnderstandingPress | null>(null)
  // 遠征開始前の累積XP。帰還画面でレベルアップを判定するために使う（保存しない）。
  const [expeditionStartXp, setExpeditionStartXp] = useState(playerProgress.totalXp)
  // Recall Encounter の進行（cue → reveal）。Recall 中以外は null。
  // Recall 中は通常の自動送り・「前へ」「次へ」・Attention を止め、Recall 側のタイマーだけで次へ進める。
  const [recallStep, setRecallStep] = useState<RecallStep | null>(null)
  const recallStepRef = useRef<RecallStep | null>(null)
  const intervalSecondsRef = useRef(intervalSeconds)
  const isLoopingRef = useRef(isLooping)
  // 自動周回のまま遠征を終えたら、次の遠征も自動周回で始める。
  const resumeLoopingRef = useRef(false)
  const sessionRef = useRef<EncounterSession>(session)
  const expeditionRef = useRef<ExpeditionState>(expedition)
  const playerProgressRef = useRef<PlayerProgress>(playerProgress)
  // 起動直後（sequence 0）は待機画面で単語を表示しないため、記録済みとして扱う。
  const recordedSequenceRef = useRef<number | undefined>(session.current.sequence)
  const feedbackTimerRef = useRef<number | undefined>(undefined)
  const pendingProgressSaveRef = useRef<number | undefined>(undefined)
  const latestProgressRef = useRef<LearningProgressMap>(progress)
  const pendingSaveRef = useRef<number | undefined>(undefined)
  const latestStateRef = useRef<LearningState>({
    currentWordId: session.lastNormalWordId,
    intervalSeconds: initialState.intervalSeconds,
    speechEnabled: initialState.speechEnabled,
    showPhrase: initialState.showPhrase,
  })
  const speechSupported =
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    'SpeechSynthesisUtterance' in window
  // 再起動時の再開位置は通常選出側の単語にする。
  const normalWordId = session.lastNormalWordId
  const currentWord = wordById.get(session.current.wordId) ?? words[0]
  const currentUnderstanding = getUnderstanding(understanding, currentWord.id)
  const currentIndex = words.indexOf(currentWord)
  const currentProgress = getWordProgress(progress, currentWord.id)
  const intervalMilliseconds = intervalSeconds * 1000
  const speedLabel = intervalSeconds.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
  // Recall の Encounter を表示中ならそのフェーズ。Recall を見せ終えて遠征完了を待つ間は reveal のまま。
  const recallPhase =
    session.current.source === 'recall' ? (recallStep?.phase ?? 'reveal') : null

  const cancelSpeech = useCallback(() => {
    if (speechSupported) {
      window.speechSynthesis.cancel()
    }
  }, [speechSupported])

  const speak = useCallback(
    (word: string) => {
      if (!speechSupported) {
        return
      }

      cancelSpeech()
      const utterance = new SpeechSynthesisUtterance(word)
      utterance.lang = 'en-US'
      window.speechSynthesis.speak(utterance)
    },
    [cancelSpeech, speechSupported],
  )

  // 新しい Encounter を表示するたびに遠征の進行度を1進める。
  // 上限に達したら自動周回を止め、未消化の再遭遇予約を破棄する。
  // 遠征完了（帰還画面）への切り替えは、最後の単語を表示した後に Effect で行う。
  // Recall の Encounter なら cue フェーズを始める（ref は同期的に更新し、直後のタイマー発火でも進ませない）。
  const showEncounter = useCallback((nextSession: EncounterSession) => {
    const nextExpedition = recordExpeditionEncounter(expeditionRef.current, nextSession.current)
    const reachedLimit = hasReachedExpeditionLimit(nextExpedition)
    const settledSession = reachedLimit ? clearReencounterQueue(nextSession) : nextSession
    const nextRecallStepValue =
      settledSession.current.source === 'recall'
        ? startRecallStep(settledSession.current.sequence, intervalSecondsRef.current)
        : null

    expeditionRef.current = nextExpedition
    sessionRef.current = settledSession
    recallStepRef.current = nextRecallStepValue
    setExpedition(nextExpedition)
    setSession(settledSession)
    setRecallStep(nextRecallStepValue)

    if (reachedLimit) {
      resumeLoopingRef.current = isLoopingRef.current
      setIsLooping(false)
    }
  }, [])

  const changeWord = useCallback(
    (direction: 'next' | 'previous') => {
      // 遠征中以外は単語を進めない（105 Encounter を超えない）。
      // Recall 中は Recall 側のタイマーだけが次へ進める（自動送りとの二重進行を防ぐ）。
      if (!isExpeditionRunning(expeditionRef.current) || recallStepRef.current !== null) {
        return
      }

      const context = {
        progress: latestProgressRef.current,
        recallWordIds,
        recallEnabled: recallEnabledInExpedition,
      }
      const nextSession =
        direction === 'next'
          ? advanceEncounter(sessionRef.current, wordIds, context)
          : retreatEncounter(sessionRef.current, context)
      // 「前へ」で戻れる語がない場合は何もしない。
      if (nextSession === sessionRef.current) {
        return
      }
      showEncounter(nextSession)

      // Recall の cue 中は英語を読み上げない（reveal で読み上げる）。
      if (nextSession.current.source === 'recall') {
        cancelSpeech()
        return
      }
      const nextWord = wordById.get(nextSession.current.wordId)
      if (speechEnabled && nextWord !== undefined) {
        speak(nextWord.english)
      }
    },
    [cancelSpeech, showEncounter, speechEnabled, speak],
  )

  const beginExpedition = () => {
    const nextExpedition = startExpedition()
    expeditionRef.current = nextExpedition
    setExpeditionStartXp(playerProgressRef.current.totalXp)
    // 開始時点ではなく、最初の単語を表示した時点で1 Encounter目として数える。
    const nextSession = startEncounter(sessionRef.current, wordIds, {
      progress: latestProgressRef.current,
      recallEnabled: recallEnabledInExpedition,
    })
    showEncounter(nextSession)

    const nextWord = wordById.get(nextSession.current.wordId)
    if (speechEnabled && nextWord !== undefined) {
      speak(nextWord.english)
    }

    if (resumeLoopingRef.current) {
      resumeLoopingRef.current = false
      setIsLooping(true)
    }
  }

  const finishExpedition = () => {
    cancelSpeech()
    const nextExpedition = returnFromExpedition(expeditionRef.current)
    expeditionRef.current = nextExpedition
    setExpedition(nextExpedition)
  }

  const goToBase = () => {
    cancelSpeech()
    resumeLoopingRef.current = false
    const nextExpedition = createIdleExpedition()
    expeditionRef.current = nextExpedition
    setExpedition(nextExpedition)
  }

  // timeStamp はイベントの発生時刻（押し始めとクリックで同じ時計）。
  const beginUnderstandingPress = (event: SyntheticEvent) => {
    understandingPressRef.current = { wordId: sessionRef.current.current.wordId, startedAt: event.timeStamp }
  }

  const cancelUnderstandingPress = () => {
    understandingPressRef.current = null
  }

  // 理解度を記録するだけ。次の語へ進める・自動周回を止める・Attention や報酬を変えることはしない。
  const answerUnderstanding = (status: UnderstandingStatus, event: SyntheticEvent) => {
    const press = understandingPressRef.current
    understandingPressRef.current = null
    const wordId = resolveUnderstandingTarget(press, event.timeStamp, sessionRef.current.current.wordId)
    const next = recordUnderstanding(understandingRef.current, wordId, status, getCurrentTimestamp())
    understandingRef.current = next
    setUnderstanding(next)
    saveUnderstanding(next)
  }

  const requestReencounter = () => {
    // Recall 自体が特別な接触なので、Recall 中の Attention は受け付けない。
    if (
      !isExpeditionRunning(expeditionRef.current) ||
      recallStepRef.current !== null ||
      sessionRef.current.current.source === 'recall'
    ) {
      return
    }

    const word = wordById.get(sessionRef.current.current.wordId)
    if (word === undefined) {
      return
    }

    // 同じ表示中の連打は1回の意思表示として数える（attentionDebt を二重に増やさない）。
    const { session: nextSession, isFirstAttention } = registerAttention(sessionRef.current)
    if (isFirstAttention) {
      const attendedAt = new Date().toISOString()
      setProgress((current) => recordAttention(current, word.id, attendedAt))
    }

    sessionRef.current = nextSession
    setSession(nextSession)

    window.clearTimeout(feedbackTimerRef.current)
    setAttentionFeedback(word)
    feedbackTimerRef.current = window.setTimeout(() => {
      setAttentionFeedback(null)
      feedbackTimerRef.current = undefined
    }, attentionFeedbackMilliseconds)
  }

  const toggleSpeech = () => {
    if (speechEnabled) {
      cancelSpeech()
    }
    setSpeechEnabled((enabled) => !enabled)
  }

  useEffect(() => {
    isLoopingRef.current = isLooping
  }, [isLooping])

  useEffect(() => {
    intervalSecondsRef.current = intervalSeconds
  }, [intervalSeconds])

  // Recall 中は通常の自動送りを止める。Recall が終わると、次の語から設定速度で再開する。
  useEffect(() => {
    if (!isLooping || recallStep !== null) {
      return
    }

    const timerId = window.setInterval(() => changeWord('next'), intervalMilliseconds)
    return () => window.clearInterval(timerId)
  }, [changeWord, intervalMilliseconds, isLooping, recallStep])

  // Recall の進行: cue（英語を隠す）→ reveal（英語を出して読み上げる）→ 次の Encounter。
  // 自動周回中かどうかに関係なく、Recall が終わったら自動的に通常の Encounter へ戻る。
  useEffect(() => {
    if (recallStep === null) {
      return
    }

    const timerId = window.setTimeout(() => {
      const next = nextRecallStep(recallStep, intervalSecondsRef.current)
      recallStepRef.current = next
      setRecallStep(next)

      if (next !== null) {
        const word = wordById.get(sessionRef.current.current.wordId)
        if (speechEnabled && word !== undefined) {
          speak(word.english)
        }
        return
      }

      // 105語目が Recall だった場合は進めず、遠征完了の Effect に任せる。
      changeWord('next')
    }, recallStep.durationMilliseconds)
    return () => window.clearTimeout(timerId)
  }, [changeWord, recallStep, speak, speechEnabled])

  // 105語目を他の語と同じ時間（設定速度ぶん）画面に見せてから帰還画面へ切り替える。
  // 105語目が Recall なら reveal を見せ終えた時点で切り替える（通常語ぶんの待ちを足さない）。
  // Effect はその表示が描画された後に動くため、最後の単語が見えないまま完了することはない。
  useEffect(() => {
    // 105語目が Recall なら、reveal まで見せ終えてから完了へ進む。
    if (!hasReachedExpeditionLimit(expedition) || recallStep !== null) {
      return
    }

    const timerId = window.setTimeout(() => {
      const nextExpedition = completeExpedition(expeditionRef.current)
      if (nextExpedition === expeditionRef.current || nextExpedition.rewards === null) {
        return
      }

      // 遠征完了の時点で報酬を確定し、すぐ保存する（帰還前に再読み込みしても失わない）。
      // running → completed の切り替えは1回だけなので、報酬が二重に加算されることはない。
      const nextPlayerProgress = applyExpeditionRewards(
        playerProgressRef.current,
        nextExpedition.rewards,
      )
      playerProgressRef.current = nextPlayerProgress
      savePlayerProgress(nextPlayerProgress)
      setPlayerProgress(nextPlayerProgress)

      expeditionRef.current = nextExpedition
      setExpedition(nextExpedition)
    }, getCompletionDelayMilliseconds(sessionRef.current.current, intervalMilliseconds))
    return () => window.clearTimeout(timerId)
  }, [expedition, intervalMilliseconds, recallStep])

  // Encounterは通し番号ごとに1回だけ記録する。
  // StrictModeでEffectが二重実行されても ref で同じ表示の二重加算を防ぐ。
  useEffect(() => {
    const encounter = session.current
    if (recordedSequenceRef.current === encounter.sequence) {
      return
    }

    recordedSequenceRef.current = encounter.sequence
    const encounteredAt = new Date().toISOString()
    setProgress((current) => recordEncounter(current, encounter.wordId, encounteredAt))
  }, [session])

  useEffect(() => {
    latestProgressRef.current = progress

    if (pendingProgressSaveRef.current !== undefined) {
      return
    }

    pendingProgressSaveRef.current = window.setTimeout(() => {
      saveLearningProgress(latestProgressRef.current)
      pendingProgressSaveRef.current = undefined
    }, progressSaveDelayMilliseconds)
  }, [progress])

  useEffect(() => {
    const flushLearningProgress = () => {
      if (pendingProgressSaveRef.current !== undefined) {
        window.clearTimeout(pendingProgressSaveRef.current)
        pendingProgressSaveRef.current = undefined
      }
      saveLearningProgress(latestProgressRef.current)
    }

    window.addEventListener('pagehide', flushLearningProgress)

    return () => {
      window.removeEventListener('pagehide', flushLearningProgress)
      flushLearningProgress()
    }
  }, [])

  useEffect(() => {
    return () => window.clearTimeout(feedbackTimerRef.current)
  }, [])

  useEffect(() => {
    latestStateRef.current = {
      currentWordId: normalWordId,
      intervalSeconds,
      speechEnabled,
      showPhrase,
    }

    if (pendingSaveRef.current !== undefined) {
      return
    }

    pendingSaveRef.current = window.setTimeout(() => {
      saveLearningState(latestStateRef.current)
      pendingSaveRef.current = undefined
    }, 500)
  }, [normalWordId, intervalSeconds, showPhrase, speechEnabled])

  useEffect(() => {
    const flushLearningState = () => {
      if (pendingSaveRef.current !== undefined) {
        window.clearTimeout(pendingSaveRef.current)
        pendingSaveRef.current = undefined
      }
      saveLearningState(latestStateRef.current)
    }

    window.addEventListener('pagehide', flushLearningState)

    return () => {
      window.removeEventListener('pagehide', flushLearningState)
      flushLearningState()
    }
  }, [])

  useEffect(() => {
    return () => {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel()
      }
    }
  }, [])

  const levelProgress = getLevelProgress(playerProgress.totalXp)
  const levelChange = getLevelChange(expeditionStartXp, playerProgress.totalXp)
  const encounterKind = getEncounterRewardKind(session.current)
  const encounterXp = calculateEncounterXp({ kind: encounterKind })
  // XP 表示は次の語が出る前に消える長さにする（高速周回で残らない）。
  const xpFlashMilliseconds = Math.round(Math.min(700, Math.max(160, intervalMilliseconds * 0.9)))
  const encounterLabel =
    encounterKind === 'recall'
      ? { className: 'is-recall', mark: '', text: 'recall' }
      : encounterKind === 'reencounter'
      ? { className: 'is-again', mark: '↻', text: 'again' }
      : encounterKind === 'growth'
        ? { className: 'is-growth', mark: '●', text: 'growth' }
        : encounterKind === 'new'
          ? { className: 'is-new', mark: '', text: 'new' }
          : null

  return (
    <main className={`word-loop is-${expedition.status}`}>
      {!speechSupported && (
        <p className="speech-notice" role="status">
          このブラウザでは音声再生を利用できません。
        </p>
      )}

      {expedition.status === 'idle' && (
        <section className="screen base-screen" aria-labelledby="base-title">
          <h1 id="base-title" className="wordmark">
            WORD LOOP
          </h1>

          <LevelSummary progress={levelProgress} totalXp={playerProgress.totalXp} />

          <dl className="stat-list">
            <div>
              <dt>Gold</dt>
              <dd>{formatNumber(playerProgress.gold)}</dd>
            </div>
            <div>
              <dt>Expeditions</dt>
              <dd>{formatNumber(playerProgress.completedExpeditions)}</dd>
            </div>
          </dl>

          <div className="next-expedition">
            <p className="eyebrow">Next expedition</p>
            <p className="next-expedition-count">
              <span className="numeral">0</span>
              <span className="muted"> / {expedition.encounterLimit}</span>
            </p>
            <p className="note">{expedition.encounterLimit} 語に出会うと、1回の遠征が終わります。</p>
          </div>

          <button type="button" className="primary-button" onClick={beginExpedition}>
            遠征を始める
          </button>
        </section>
      )}

      {expedition.status === 'running' && (
        <>
          <header className="hud" aria-label="遠征の状況">
            <p className="hud-level">Lv. {levelProgress.level}</p>
            <p
              className="hud-count"
              aria-label={`遠征 ${expedition.encounterCount} / ${expedition.encounterLimit} Encounter`}
            >
              <span className="numeral">{expedition.encounterCount}</span>
              <span className="muted"> / {expedition.encounterLimit}</span>
            </p>
            <div className="hud-line" aria-hidden="true">
              <span
                style={{
                  transform: `scaleX(${expedition.encounterCount / expedition.encounterLimit})`,
                }}
              />
            </div>
            <p className="hud-xp" aria-label={`今回の遠征で ${expedition.xp} XP`}>
              {/* Recall の XP はカード内に reveal で表示する */}
              <span
                key={session.current.sequence}
                className={`xp-gain is-${encounterKind}`}
                style={{ animationDuration: `${xpFlashMilliseconds}ms` }}
                aria-hidden="true"
              >
                {recallPhase === null ? `+${encounterXp}` : ''}
              </span>
              <span className="numeral">{formatNumber(expedition.xp)}</span> XP
            </p>
          </header>

          <section
            className={recallPhase === null ? 'word-card' : `word-card is-recall is-${recallPhase}`}
            aria-live="polite"
          >
            {recallPhase === null && (
              <button
                type="button"
                className="reencounter-button"
                onClick={requestReencounter}
                aria-label={`${currentWord.english}をもう一度出す`}
              />
            )}

            <p className="encounter-label">
              {encounterLabel !== null && (
                <span className={encounterLabel.className}>
                  {encounterLabel.mark !== '' && (
                    <span aria-hidden="true">{encounterLabel.mark} </span>
                  )}
                  {encounterLabel.text}
                </span>
              )}
            </p>

            {/*
              カードは「英語 → 訳 → 画像 → 補助文 → ヒント」の高さ固定の行で組む。
              語の長さ・ラベルの有無・補助文の ON/OFF が変わっても行の高さは変わらないので、英語や画像の位置は動かない。
              遠征では Recall を出さない（Task 014）ため、英語と日本語は常に同時に表示する。
            */}
            <div className="word-copy">
              <div className="headline">
                {/* 長い語・phrase は文字数に応じて縮め、1行に収める */}
                <h1
                  className="english"
                  style={{ '--english-length': currentWord.english.length } as CSSProperties}
                >
                  {currentWord.english}
                </h1>
              </div>
              <p className="translation">{currentWord.japanese}</p>
            </div>

            <div className="image-area" role="img" aria-label={currentWord.image.alt}>
              {currentWord.image.placeholder === neutralImagePlaceholder ? (
                // 画像未設定の項目は、どの語でも同じ控えめな図形を出す
                <span className="image-placeholder" aria-hidden="true" />
              ) : (
                <span aria-hidden="true">{currentWord.image.placeholder}</span>
              )}
            </div>

            <p className="phrase">{showPhrase ? currentWord.phrase : ''}</p>

            {/* ヒントと「もう一度出します」は同じ高さ固定の行に出す（下の理解度ボタンと重ならない） */}
            <p className="tap-hint" role="status">
              {attentionFeedback === null ? (
                <span className="tap-hint-text" aria-hidden="true">
                  タップでもう一度
                </span>
              ) : (
                <span className="reencounter-feedback">
                  <span aria-hidden="true">↻</span> {attentionFeedback.english} をもう一度出します
                </span>
              )}
            </p>

            {/*
              理解度の自己申告（任意）。押さなくても自動周回は止まらず、未回答は「まだわからない」とは扱わない。
              カード全体の「もう一度」ボタンより手前に置き、Attention とは別の操作にする。
            */}
            <div className="understanding" role="group" aria-label="この語の理解度（任意）">
              {understandingOptions.map((option) => {
                const isSelected = currentUnderstanding?.status === option.status
                return (
                  <button
                    key={option.status}
                    type="button"
                    className={`understanding-button is-${option.status}`}
                    aria-pressed={isSelected}
                    onPointerDown={beginUnderstandingPress}
                    onPointerCancel={cancelUnderstandingPress}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        beginUnderstandingPress(event)
                      }
                    }}
                    onClick={(event) => answerUnderstanding(option.status, event)}
                  >
                    {isSelected && <span aria-hidden="true">✓ </span>}
                    {option.label}
                  </button>
                )
              })}
            </div>
          </section>

          <div className="controls">
            <nav className="transport" aria-label="単語の移動と自動周回">
              <button
                type="button"
                className="ghost-button"
                onClick={() => changeWord('previous')}
                disabled={!isExpeditionRunning(expedition) || recallStep !== null}
              >
                前へ
              </button>
              <button
                type="button"
                className="loop-toggle"
                onClick={() => setIsLooping((looping) => !looping)}
                disabled={!isExpeditionRunning(expedition)}
                aria-pressed={isLooping}
              >
                <span aria-hidden="true">{isLooping ? '❚❚' : '▶'}</span>
                {isLooping ? ' 停止' : ' 自動周回'}
              </button>
              <button
                type="button"
                className="ghost-button"
                onClick={() => changeWord('next')}
                disabled={!isExpeditionRunning(expedition) || recallStep !== null}
              >
                次へ
              </button>
            </nav>

            <section className="settings" aria-label="自動周回の設定">
              <div className="speed-presets" aria-label="速度プリセット" role="group">
                {speedPresets.map((preset) => (
                  <button
                    type="button"
                    key={preset.label}
                    className={intervalSeconds === preset.seconds ? 'is-selected' : undefined}
                    onClick={() => setIntervalSeconds(preset.seconds)}
                    aria-pressed={intervalSeconds === preset.seconds}
                    aria-label={`${preset.label} ${preset.seconds}秒/語`}
                  >
                    {preset.seconds}s
                  </button>
                ))}
              </div>

              <label className="speed-control">
                <span>速度 {speedLabel}秒/語</span>
                <input
                  type="range"
                  min="0.2"
                  max="3"
                  step="0.05"
                  value={intervalSeconds}
                  onChange={(event) => setIntervalSeconds(Number(event.target.value))}
                />
              </label>

              <div className="toggles">
                <button
                  type="button"
                  className="text-toggle"
                  onClick={toggleSpeech}
                  disabled={!speechSupported}
                  aria-pressed={speechEnabled}
                >
                  音声 {speechEnabled ? 'ON' : 'OFF'}
                </button>
                <button
                  type="button"
                  className="text-toggle"
                  onClick={() => setShowPhrase((visible) => !visible)}
                  aria-pressed={showPhrase}
                >
                  補助文 {showPhrase ? 'ON' : 'OFF'}
                </button>
                <button
                  type="button"
                  className="text-toggle"
                  onClick={() => speak(currentWord.english)}
                  disabled={!speechSupported || !speechEnabled || recallPhase === 'cue'}
                  aria-label={`${currentWord.english}を再生`}
                >
                  再生
                </button>
              </div>
            </section>
          </div>
        </>
      )}

      {expedition.status === 'completed' && expedition.rewards !== null && (
        <section className="screen result-screen" aria-labelledby="result-title" role="status">
          <p className="eyebrow">Expedition complete</p>
          <h1 id="result-title" className="screen-title">
            遠征完了
          </h1>

          <dl className="reward-list">
            <div>
              <dt>XP</dt>
              <dd>+{formatNumber(expedition.rewards.xp)}</dd>
            </div>
            <div>
              <dt>Gold</dt>
              <dd>+{formatNumber(expedition.rewards.gold)}</dd>
            </div>
          </dl>

          <hr className="rule" />

          <dl className="breakdown">
            <div>
              <dt>encounters</dt>
              <dd>{expedition.encounterCount}</dd>
            </div>
            <div>
              <dt>familiar</dt>
              <dd>{expedition.familiarCount}</dd>
            </div>
            <div>
              <dt>new</dt>
              <dd>{expedition.newCount}</dd>
            </div>
            <div>
              <dt>
                <span className="mark-growth" aria-hidden="true">● </span>growth
              </dt>
              <dd>{expedition.growthCount}</dd>
            </div>
            <div>
              <dt>
                <span className="mark-again" aria-hidden="true">↻ </span>again
              </dt>
              <dd>{expedition.reencounterCount}</dd>
            </div>
          </dl>

          <button type="button" className="primary-button" onClick={finishExpedition}>
            帰還する
          </button>
        </section>
      )}

      {expedition.status === 'returned' && expedition.rewards !== null && (
        <section className="screen return-screen" aria-labelledby="return-title" role="status">
          <p className="eyebrow">Returned</p>
          <h1 id="return-title" className="screen-title">
            {expedition.encounterCount} 語に出会い、帰還しました
          </h1>

          {levelChange.leveledUp && (
            <div className="level-up" aria-label={`レベルアップ Lv. ${levelChange.from} から Lv. ${levelChange.to}`}>
              <p className="eyebrow">Level up</p>
              <p className="level-up-values" aria-hidden="true">
                <span className="muted">Lv. {levelChange.from}</span>
                <span className="level-up-arrow">→</span>
                <span>Lv. {levelChange.to}</span>
              </p>
            </div>
          )}

          <LevelSummary
            progress={levelProgress}
            totalXp={playerProgress.totalXp}
            compact={levelChange.leveledUp}
          />

          <div className="return-columns">
            <div>
              <p className="eyebrow">This expedition</p>
              <dl className="stat-list">
                <div>
                  <dt>XP</dt>
                  <dd>+{formatNumber(expedition.rewards.xp)}</dd>
                </div>
                <div>
                  <dt>Gold</dt>
                  <dd>+{formatNumber(expedition.rewards.gold)}</dd>
                </div>
              </dl>
            </div>
            <div>
              <p className="eyebrow">Total</p>
              <dl className="stat-list">
                <div>
                  <dt>XP</dt>
                  <dd>{formatNumber(playerProgress.totalXp)}</dd>
                </div>
                <div>
                  <dt>Gold</dt>
                  <dd>{formatNumber(playerProgress.gold)}</dd>
                </div>
                <div>
                  <dt>Expeditions</dt>
                  <dd>{formatNumber(playerProgress.completedExpeditions)}</dd>
                </div>
              </dl>
            </div>
          </div>

          <button type="button" className="primary-button" onClick={beginExpedition}>
            次の遠征へ
          </button>
          <button type="button" className="link-button" onClick={goToBase}>
            拠点に戻る
          </button>
        </section>
      )}

      <p className="dev-stats" aria-label="開発確認用の表示">
        dev · 単語 {currentIndex + 1}/{words.length} · Encounter {currentProgress.encounterCount} ·
        Attention {currentProgress.attentionCount} · debt {currentProgress.attentionDebt} · 再遭遇予約{' '}
        {session.reencounterQueue.length}
        {session.current.source === 'reencounter' ? ' · 再遭遇中' : ` · ${session.current.bucket}`}
        {expedition.status === 'running' &&
          ` · F/N/G/R ${expedition.familiarCount}/${expedition.newCount}/${expedition.growthCount}/${expedition.reencounterCount}`}
      </p>
    </main>
  )
}

const numberFormat = new Intl.NumberFormat('en-US')

function formatNumber(value: number) {
  return numberFormat.format(value)
}

type LevelSummaryProps = {
  progress: LevelProgress
  totalXp: number
  compact?: boolean
}

// 現在のレベルと次のレベルまでの進捗。拠点と帰還画面で共通。
function LevelSummary({ progress, totalXp, compact = false }: LevelSummaryProps) {
  const remainingXp = progress.nextLevelTotalXp - totalXp
  return (
    <div className={compact ? 'level-summary is-compact' : 'level-summary'}>
      <p className="level-value">
        <span className="level-prefix">Lv.</span> {progress.level}
      </p>
      <p className="level-xp">
        <span className="numeral">{formatNumber(totalXp)}</span>
        <span className="muted"> / {formatNumber(progress.nextLevelTotalXp)} XP</span>
      </p>
      <div
        className="level-bar"
        role="progressbar"
        aria-label={`次のレベルまで ${remainingXp} XP`}
        aria-valuemin={0}
        aria-valuemax={progress.nextLevelXp}
        aria-valuenow={progress.currentLevelXp}
      >
        <span style={{ transform: `scaleX(${progress.progressRatio})` }} />
      </div>
      <p className="note">Lv. {progress.level + 1} まで {formatNumber(remainingXp)} XP</p>
    </div>
  )
}

export default App
