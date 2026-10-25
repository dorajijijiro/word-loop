import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type SyntheticEvent,
} from 'react'
import { neutralImagePlaceholder, wordRankLabels, wordRankOrder, words } from './data/words'
import {
  advanceEncounter,
  cancelReencounter,
  clearReencounterQueue,
  createEncounterSession,
  reserveReencounter,
  retreatEncounter,
  startEncounter,
  type EncounterSession,
} from './lib/encounterEngine'
import {
  completeExhaustedExpedition,
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
import {
  createCatState,
  getNextCatUpdateAt,
  isCatEating,
  recordCatAnswer,
  updateCat,
  type CatState,
} from './lib/catCompanion'
import catSpriteUrl from './assets/cat-sprite.png'
import { getEncounterRewardKind } from './lib/rewards'
import {
  answerUnderstanding,
  getUnderstanding,
  handleUnderstandingKeyDown,
  loadUnderstanding,
  resolveUnderstandingTarget,
  saveUnderstanding,
  startUnderstandingPress,
  type UnderstandingAnswerBases,
  type UnderstandingMap,
  type UnderstandingPress,
  type UnderstandingStatus,
  type UnderstandingTarget,
} from './lib/understanding'
import { getFocusTrapTarget } from './lib/focusTrap'
import { nextRecallStep, startRecallStep, type RecallStep } from './lib/recall'
import {
  createWordAudioPlayer,
  getWordAudioUrl,
  wordAudioFailureLabels,
  type WordAudioEvent,
  type WordAudioFailure,
  type WordAudioPlayer,
} from './lib/wordAudio'
import './App.css'

const speedPresets = [
  { label: '超高速', seconds: 0.25 },
  { label: '高速', seconds: 0.5 },
  { label: '標準', seconds: 1 },
  { label: 'ゆっくり', seconds: 2 },
]

const wordIds = words.map((word) => word.id)
const wordById = new Map(words.map((word) => [word.id, word]))
// 左 ×（まだわからない）、右 ✓（わかる）。
const understandingOptions: { status: UnderstandingStatus; symbol: string; label: string }[] = [
  { status: 'unknown', symbol: '×', label: 'まだわからない' },
  { status: 'known', symbol: '✓', label: 'わかる' },
]
const getCurrentTimestamp = () => new Date().toISOString()
const getCurrentMilliseconds = () => Date.now()
const progressSaveDelayMilliseconds = 1000

function App() {
  const [initialState] = useState(loadLearningState)
  const [session, setSession] = useState(() =>
    createEncounterSession(wordIds, initialState.currentWordId),
  )
  const [progress, setProgress] = useState(loadLearningProgress)
  const [speechEnabled, setSpeechEnabled] = useState(initialState.speechEnabled)
  const [showPhrase, setShowPhrase] = useState(initialState.showPhrase)
  const [showAnswerHints, setShowAnswerHints] = useState(initialState.showAnswerHints)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsButtonRef = useRef<HTMLButtonElement>(null)
  const settingsPanelRef = useRef<HTMLElement>(null)
  // 猫の反応・イベント（遠征の中だけで持ち、保存しない）。
  const [cat, setCat] = useState(createCatState)
  const catRef = useRef<CatState>(cat)
  const [isLooping, setIsLooping] = useState(false)
  const [intervalSeconds, setIntervalSeconds] = useState(initialState.intervalSeconds)
  const [expedition, setExpedition] = useState(createIdleExpedition)
  const [playerProgress, setPlayerProgress] = useState(loadPlayerProgress)
  const [understanding, setUnderstanding] = useState(loadUnderstanding)
  const understandingRef = useRef<UnderstandingMap>(understanding)
  // 理解度ボタンを押し始めた時点の語。高速周回で押下中に表示が変わっても、この語に記録する。
  const understandingPressRef = useRef<UnderstandingPress | null>(null)
  // Encounter ごとの回答前の記録。同じ Encounter での連打・訂正を1回分として扱う（保存しない）。
  const answerBasesRef = useRef<UnderstandingAnswerBases>({})
  // 遠征を始めようとしたときに、今出せる語が1つもなかった（拠点で案内を出す）。
  const [noReviewNotice, setNoReviewNotice] = useState(false)
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
  const pendingProgressSaveRef = useRef<number | undefined>(undefined)
  const latestProgressRef = useRef<LearningProgressMap>(progress)
  const pendingSaveRef = useRef<number | undefined>(undefined)
  const latestStateRef = useRef<LearningState>({
    currentWordId: session.lastNormalWordId,
    intervalSeconds: initialState.intervalSeconds,
    speechEnabled: initialState.speechEnabled,
    showPhrase: initialState.showPhrase,
    showAnswerHints: initialState.showAnswerHints,
  })
  // 遠征の発音は Task 020 で生成した Kokoro の MP3 を再生する（Task 021）。ブラウザの音声合成は使わない。
  const audioSupported = typeof window !== 'undefined' && typeof window.Audio === 'function'
  const audioPlayerRef = useRef<WordAudioPlayer | null>(null)
  // 最後に再生できなかった理由。次に再生できた時点、音声 OFF・遠征の終了で消す（保存しない）。
  const [audioIssue, setAudioIssue] = useState<{ wordId: string; reason: WordAudioFailure } | null>(null)
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

  const handleAudioEvent = useCallback((event: WordAudioEvent) => {
    if (event.type === 'playing') {
      setAudioIssue(null)
    } else if (event.type === 'failed') {
      setAudioIssue({ wordId: event.wordId, reason: event.reason })
    }
  }, [])

  // 再生・読み込み中の音声を止める。まだ一度も再生していなければ何もしない。
  const cancelSpeech = useCallback(() => {
    audioPlayerRef.current?.stop()
  }, [])

  // 表示中の語の音声を先頭から再生する（前の音声は止める）。失敗しても遠征・タイマーには影響しない。
  const speak = useCallback(
    (wordId: string) => {
      if (!audioSupported) {
        return
      }
      audioPlayerRef.current ??= createWordAudioPlayer({
        createAudio: () => new Audio(),
        resolveUrl: (id) => getWordAudioUrl(id, import.meta.env.BASE_URL),
        onEvent: handleAudioEvent,
      })
      audioPlayerRef.current.play(wordId)
    },
    [audioSupported, handleAudioEvent],
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

  // 遠征完了の時点で報酬を確定し、すぐ保存する（帰還前に再読み込みしても失わない）。
  // running → completed の切り替えは1回だけなので、報酬が二重に加算されることはない。
  const settleExpedition = useCallback((nextExpedition: ExpeditionState) => {
    if (nextExpedition === expeditionRef.current || nextExpedition.rewards === null) {
      return
    }

    const nextPlayerProgress = applyExpeditionRewards(playerProgressRef.current, nextExpedition.rewards)
    playerProgressRef.current = nextPlayerProgress
    savePlayerProgress(nextPlayerProgress)
    setPlayerProgress(nextPlayerProgress)

    expeditionRef.current = nextExpedition
    setExpedition(nextExpedition)
    // 遠征が終わったら設定を閉じる
    setSettingsOpen(false)
  }, [])

  const changeWord = useCallback(
    (direction: 'next' | 'previous') => {
      // 遠征中以外は単語を進めない（105 Encounter を超えない）。
      // Recall 中は Recall 側のタイマーだけが次へ進める（自動送りとの二重進行を防ぐ）。
      if (!isExpeditionRunning(expeditionRef.current) || recallStepRef.current !== null) {
        return
      }

      const nextSession =
        direction === 'next'
          ? advanceEncounter(sessionRef.current, wordIds, {
              progress: latestProgressRef.current,
              understanding: understandingRef.current,
              now: getCurrentMilliseconds(),
              rankOrder: wordRankOrder,
            })
          : retreatEncounter(sessionRef.current, { progress: latestProgressRef.current })
      // 今すぐ出せる候補がない: 上限の前でも、表示した分の報酬で遠征を終える（同じ語や期日前の語で埋めない）。
      if (nextSession === null) {
        const settledSession = clearReencounterQueue(sessionRef.current)
        sessionRef.current = settledSession
        setSession(settledSession)
        resumeLoopingRef.current = isLoopingRef.current
        setIsLooping(false)
        cancelSpeech()
        settleExpedition(completeExhaustedExpedition(expeditionRef.current))
        return
      }
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
        speak(nextWord.id)
      }
    },
    [cancelSpeech, settleExpedition, showEncounter, speechEnabled, speak],
  )

  const beginExpedition = () => {
    const nextSession = startEncounter(sessionRef.current, wordIds, {
      progress: latestProgressRef.current,
      understanding: understandingRef.current,
      now: getCurrentMilliseconds(),
      rankOrder: wordRankOrder,
    })
    // 今出せる語が1つもなければ、空の遠征を作らずに拠点で案内する（報酬・完了遠征数は増えない）。
    if (nextSession === null) {
      cancelSpeech()
      resumeLoopingRef.current = false
      const idleExpedition = createIdleExpedition()
      expeditionRef.current = idleExpedition
      setExpedition(idleExpedition)
      setNoReviewNotice(true)
      return
    }

    setNoReviewNotice(false)
    setAudioIssue(null)
    const nextCat = createCatState()
    catRef.current = nextCat
    setCat(nextCat)
    const nextExpedition = startExpedition()
    expeditionRef.current = nextExpedition
    setExpeditionStartXp(playerProgressRef.current.totalXp)
    // 開始時点ではなく、最初の単語を表示した時点で1 Encounter目として数える。
    showEncounter(nextSession)

    const nextWord = wordById.get(nextSession.current.wordId)
    if (speechEnabled && nextWord !== undefined) {
      speak(nextWord.id)
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
    setNoReviewNotice(false)
    const nextExpedition = createIdleExpedition()
    expeditionRef.current = nextExpedition
    setExpedition(nextExpedition)
  }

  // 表示中の語と、その Encounter の通し番号。
  const getCurrentTarget = (): UnderstandingTarget => ({
    wordId: sessionRef.current.current.wordId,
    sequence: sessionRef.current.current.sequence,
  })

  // timeStamp はイベントの発生時刻（押し始めとクリックで同じ時計）。
  const beginUnderstandingPress = (event: SyntheticEvent) => {
    understandingPressRef.current = startUnderstandingPress(event.timeStamp, getCurrentTarget())
  }

  // Enter / Space の自動リピートでは押し始めの語を上書きせず、Enter の連続回答も止める。
  const handleUnderstandingKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const result = handleUnderstandingKeyDown(
      understandingPressRef.current,
      event.key,
      event.repeat,
      event.timeStamp,
      getCurrentTarget(),
    )
    understandingPressRef.current = result.press
    if (result.preventDefault) {
      event.preventDefault()
    }
  }

  const cancelUnderstandingPress = () => {
    understandingPressRef.current = null
  }

  // 理解度を記録し、次回の出題期日を決める。次の語へ進める・自動周回を止めることはしない。
  // 「まだわからない」は別の語を挟んだ後の再登場を予約し、「わかる」への訂正は予約を取り消す。
  const handleUnderstandingAnswer = (status: UnderstandingStatus, event: SyntheticEvent) => {
    const press = understandingPressRef.current
    understandingPressRef.current = null
    const target = resolveUnderstandingTarget(press, event.timeStamp, getCurrentTarget())
    const result = answerUnderstanding(
      understandingRef.current,
      answerBasesRef.current,
      target,
      status,
      getCurrentTimestamp(),
    )
    understandingRef.current = result.map
    answerBasesRef.current = result.bases
    setUnderstanding(result.map)
    saveUnderstanding(result.map)

    if (!isExpeditionRunning(expeditionRef.current)) {
      return
    }
    // 猫の反応。✓ / × で同じ。同じ Encounter の連打・訂正では進まない。自動送りのタイマーには触れない。
    const nextCat = recordCatAnswer(catRef.current, target.sequence, getCurrentMilliseconds())
    if (nextCat !== catRef.current) {
      catRef.current = nextCat
      setCat(nextCat)
    }
    const nextSession =
      status === 'unknown'
        ? reserveReencounter(sessionRef.current, target.wordId, target.sequence)
        : cancelReencounter(sessionRef.current, target.wordId)
    if (nextSession !== sessionRef.current) {
      sessionRef.current = nextSession
      setSession(nextSession)
    }
  }

  const closeSettings = () => {
    setSettingsOpen(false)
    settingsButtonRef.current?.focus()
  }

  // Escape で閉じる。Tab は設定の中だけを巡回する。
  const handleSettingsKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeSettings()
      return
    }
    if (event.key !== 'Tab' || settingsPanelRef.current === null) {
      return
    }
    const focusable = [...settingsPanelRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')]
    // 開いた直後はパネル本体にフォーカスがあるので、Shift+Tab でも背後の「設定」ボタンへ抜けないよう中の最後へ移す。
    const target = getFocusTrapTarget(
      focusable.length,
      focusable.indexOf(document.activeElement as HTMLElement),
      event.shiftKey,
    )
    if (target !== null) {
      event.preventDefault()
      focusable[target].focus()
    } else if (focusable.length === 0) {
      event.preventDefault()
    }
  }

  const toggleSpeech = () => {
    if (speechEnabled) {
      cancelSpeech()
      setAudioIssue(null)
    }
    setSpeechEnabled((enabled) => !enabled)
  }

  // 自動周回を止めたら、今の音声も止める（停止中も「発音を再生」で再生できる）。
  // 再開したときは表示中の語を設定秒数だけ見せてから次へ進む（ここでは再生しないので二重に始まらない）。
  const toggleLooping = () => {
    if (isLooping) {
      cancelSpeech()
    }
    setIsLooping((looping) => !looping)
  }

  useEffect(() => {
    isLoopingRef.current = isLooping
  }, [isLooping])

  // 猫の反応・食事の終了と、保留の食事の開始。自動送りのタイマーとは別のタイマーで動かす。
  useEffect(() => {
    const nextUpdateAt = getNextCatUpdateAt(cat)
    if (nextUpdateAt === null) {
      return
    }
    const timerId = window.setTimeout(() => {
      const next = updateCat(catRef.current, getCurrentMilliseconds())
      catRef.current = next
      setCat(next)
    }, Math.max(0, nextUpdateAt - getCurrentMilliseconds()))
    return () => window.clearTimeout(timerId)
  }, [cat])

  // 設定を開いたら中へフォーカスを移す。
  useEffect(() => {
    if (settingsOpen) {
      settingsPanelRef.current?.focus()
    }
  }, [settingsOpen])

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
          speak(word.id)
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

    const timerId = window.setTimeout(
      () => settleExpedition(completeExpedition(expeditionRef.current)),
      getCompletionDelayMilliseconds(sessionRef.current.current, intervalMilliseconds),
    )
    return () => window.clearTimeout(timerId)
  }, [expedition, intervalMilliseconds, recallStep, settleExpedition])

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
    latestStateRef.current = {
      currentWordId: normalWordId,
      intervalSeconds,
      speechEnabled,
      showPhrase,
      showAnswerHints,
    }

    if (pendingSaveRef.current !== undefined) {
      return
    }

    pendingSaveRef.current = window.setTimeout(() => {
      saveLearningState(latestStateRef.current)
      pendingSaveRef.current = undefined
    }, 500)
  }, [normalWordId, intervalSeconds, showAnswerHints, showPhrase, speechEnabled])

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

  // 遠征中以外（帰還画面・拠点）では音声を止める。再生できなかった表示は遠征中にしか出さず、次の遠征の開始時に消す。
  useEffect(() => {
    if (expedition.status !== 'running') {
      cancelSpeech()
    }
  }, [cancelSpeech, expedition.status])

  // 画面を離れたとき（別のタブ・アプリへの切り替え、ページを閉じる、試聴画面への移動）は音声を止める。
  useEffect(() => {
    const stopWhenHidden = () => {
      if (document.visibilityState === 'hidden') {
        cancelSpeech()
      }
    }
    document.addEventListener('visibilitychange', stopWhenHidden)
    window.addEventListener('pagehide', cancelSpeech)
    return () => {
      document.removeEventListener('visibilitychange', stopWhenHidden)
      window.removeEventListener('pagehide', cancelSpeech)
      cancelSpeech()
    }
  }, [cancelSpeech])

  const levelProgress = getLevelProgress(playerProgress.totalXp)
  const levelChange = getLevelChange(expeditionStartXp, playerProgress.totalXp)
  const encounterKind = getEncounterRewardKind(session.current)
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
      {!audioSupported && (
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
            <p className="note">
              1回の遠征は最大 {expedition.encounterLimit} 語。今出せる語を出し終えると、そこで終わります。
            </p>
          </div>

          {noReviewNotice && (
            <p className="no-review-notice" role="status">
              今の復習はありません。
            </p>
          )}

          <button type="button" className="primary-button" onClick={beginExpedition}>
            遠征を始める
          </button>

          {/* Task 019: 音声の試聴画面（学習の記録には影響しない） */}
          <a className="preview-entry" href="#audio-preview">
            音声の試聴（Kokoro）
          </a>
        </section>
      )}

      {expedition.status === 'running' && (
        <>
          {/* 学習中は進行度だけを出す（XP・Gold・Level は結果・拠点画面で表示する） */}
          <header className="hud" aria-label="遠征の状況">
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
          </header>

          <section
            className={recallPhase === null ? 'word-card' : `word-card is-recall is-${recallPhase}`}
            aria-live="polite"
          >
            <p className="encounter-label">
              {encounterLabel !== null && (
                <span className={encounterLabel.className}>
                  {encounterLabel.mark !== '' && (
                    <span aria-hidden="true">{encounterLabel.mark} </span>
                  )}
                  {encounterLabel.text}
                </span>
              )}
              <span className="rank-label">{wordRankLabels[currentWord.rank]}</span>
            </p>

            {/*
              カードは「英語 → 訳 → 画像 → 補助文」の高さ固定の行で、上から積む。
              語の長さ・ラベルの有無・補助文の ON/OFF・下の猫や回答ボタンの状態が変わっても、英語や画像の位置は動かない。
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

            <div className="image-slot">
              <div className="image-area" role="img" aria-label={currentWord.image.alt}>
                {currentWord.image.placeholder === neutralImagePlaceholder ? (
                  // 画像未設定の項目は、どの語でも同じ控えめな図形を出す
                  <span className="image-placeholder" aria-hidden="true" />
                ) : (
                  <span aria-hidden="true">{currentWord.image.placeholder}</span>
                )}
              </div>
              {/* 音声を再生できなかったときの控えめな表示。画像枠の右上に重ねるので英語や画像の位置は動かない。 */}
              {speechEnabled && audioIssue !== null && (
                <AudioIssueBadge reason={audioIssue.reason} onRetry={() => speak(currentWord.id)} />
              )}
            </div>

            <p className="phrase">{showPhrase ? currentWord.phrase : ''}</p>
          </section>

          {/* 画面下部にまとめる: 猫 → 回答ボタン → 移動・自動周回・設定 */}
          <div className="study-dock">
            <CatStage cat={cat} />

            {/*
              理解度の自己申告（任意）。左 × = まだわからない、右 ✓ = わかる。大きさ・強調は同じで、正誤の色は使わない。
              押さなくても自動周回は止まらず、未回答は「まだわからない」とは扱わない。回答しても次の語へは進めない。
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
                    aria-label={option.label}
                    onPointerDown={beginUnderstandingPress}
                    onPointerCancel={cancelUnderstandingPress}
                    onKeyDown={handleUnderstandingKey}
                    onClick={(event) => handleUnderstandingAnswer(option.status, event)}
                  >
                    <span className="answer-symbol" aria-hidden="true">
                      {option.symbol}
                    </span>
                    {/* 説明は設定で隠せる。隠しても高さは変えず、読み上げ用の名前（aria-label）は残る */}
                    <span className={showAnswerHints ? 'answer-hint' : 'answer-hint is-hidden'} aria-hidden="true">
                      {option.label}
                    </span>
                  </button>
                )
              })}
            </div>

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
                onClick={toggleLooping}
                disabled={!isExpeditionRunning(expedition)}
                aria-pressed={isLooping}
                aria-label={isLooping ? '自動周回を停止' : '自動周回を開始'}
              >
                <span aria-hidden="true">{isLooping ? '❚❚ 停止' : '▶ 再生'}</span>
              </button>
              <button
                type="button"
                className="ghost-button"
                onClick={() => changeWord('next')}
                disabled={!isExpeditionRunning(expedition) || recallStep !== null}
              >
                次へ
              </button>
              <button
                ref={settingsButtonRef}
                type="button"
                className="ghost-button settings-button"
                onClick={() => setSettingsOpen(true)}
                aria-haspopup="dialog"
                aria-expanded={settingsOpen}
              >
                設定
              </button>
            </nav>
          </div>

          {settingsOpen && (
            // 設定はカードの上に重ねて開く（カードや回答ボタンの位置は動かない）。開いている間も自動周回は続く。
            <div className="settings-backdrop" onClick={closeSettings}>
              <section
                ref={settingsPanelRef}
                className="settings-sheet"
                role="dialog"
                aria-modal="true"
                aria-labelledby="settings-title"
                tabIndex={-1}
                onClick={(event) => event.stopPropagation()}
                onKeyDown={handleSettingsKey}
              >
                <div className="settings-header">
                  <h2 id="settings-title">設定</h2>
                  <button type="button" className="text-toggle" onClick={closeSettings}>
                    閉じる
                  </button>
                </div>

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
                    disabled={!audioSupported}
                    aria-pressed={speechEnabled}
                  >
                    音声 {speechEnabled ? 'ON' : 'OFF'}
                  </button>
                  <button
                    type="button"
                    className="text-toggle"
                    onClick={() => speak(currentWord.id)}
                    disabled={!audioSupported || !speechEnabled || recallPhase === 'cue'}
                    aria-label={`${currentWord.english}の発音を再生`}
                  >
                    発音を再生
                  </button>
                </div>
                <div className="toggles">
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
                    onClick={() => setShowAnswerHints((visible) => !visible)}
                    aria-pressed={showAnswerHints}
                  >
                    ボタンの説明 {showAnswerHints ? 'ON' : 'OFF'}
                  </button>
                </div>
              </section>
            </div>
          )}
        </>
      )}

      {expedition.status === 'completed' && expedition.rewards !== null && (
        <section className="screen result-screen" aria-labelledby="result-title" role="status">
          <p className="eyebrow">Expedition complete</p>
          <h1 id="result-title" className="screen-title">
            遠征完了
          </h1>
          {expedition.endReason === 'exhausted' && (
            <p className="note">今出せる語を出し終えました。</p>
          )}

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

      {/* 開発用表示は学習中には出さない（Task 017） */}
      {expedition.status !== 'running' && (
        <p className="dev-stats" aria-label="開発確認用の表示">
          dev · 単語 {currentIndex + 1}/{words.length} · Encounter {currentProgress.encounterCount} ·
          Attention {currentProgress.attentionCount} · debt {currentProgress.attentionDebt} · 理解{' '}
          {currentUnderstanding === null
            ? '未回答'
            : `${currentUnderstanding.status}×${currentUnderstanding.knownStreak}`}{' '}
          · 再遭遇予約 {session.reencounterQueue.length}
          {session.current.source === 'reencounter' ? ' · 再遭遇中' : ` · ${session.current.bucket}`}
        </p>
      )}
    </main>
  )
}

const numberFormat = new Intl.NumberFormat('en-US')

function formatNumber(value: number) {
  return numberFormat.format(value)
}

// 回答ボタンのすぐ上の、高さ固定の猫の領域。演出は領域の中だけで動き、ほかのレイアウトを動かさない。
// reduced-motion では歩行・跳ねる動きを止め、静止ポーズと短い表示（♪・もぐもぐ）で伝える。
function CatStage({ cat }: { cat: CatState }) {
  const eating = isCatEating(cat)
  return (
    <div className="cat-stage">
      <div
        className={eating ? 'cat-walker is-eating' : 'cat-walker'}
        style={{ '--cat-sprite': `url(${catSpriteUrl})` } as CSSProperties}
        aria-hidden="true"
      >
        {/* 向き（往復で反転）→ 小さく跳ねる反応 → コマ送りの順に重ねる。文字（♪・もぐもぐ）は反転させない。 */}
        <span className="cat-facing">
          <span key={cat.reaction?.id ?? 0} className={cat.reaction === null ? 'cat-body' : 'cat-body is-reacting'}>
            <span className="cat-sprite" />
          </span>
          {eating && <span className="cat-bowl" />}
        </span>
        {cat.reaction !== null && !eating && (
          <span key={cat.reaction.id} className="cat-note">
            ♪
          </span>
        )}
        {eating && <span className="cat-note is-eating">もぐもぐ</span>}
      </div>
      <p className="visually-hidden" role="status">
        {eating ? 'ねこがごはんを食べています' : ''}
      </p>
    </div>
  )
}

type LevelSummaryProps = {
  progress: LevelProgress
  totalXp: number
  compact?: boolean
}

// 現在のレベルと次のレベルまでの進捗。拠点と帰還画面で共通。
// 音声を再生できなかったことを伝える小さな表示。読み込み失敗・自動再生の拒否は押すと再生し直す。
function AudioIssueBadge({ reason, onRetry }: { reason: WordAudioFailure; onRetry: () => void }) {
  const label = wordAudioFailureLabels[reason]
  return label.retry ? (
    <button type="button" className={`audio-issue is-${reason}`} onClick={onRetry} aria-label={label.description}>
      {label.short}
    </button>
  ) : (
    <span className={`audio-issue is-${reason}`} role="status" aria-label={label.description}>
      {label.short}
    </span>
  )
}

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
