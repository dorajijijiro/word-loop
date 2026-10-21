import { useCallback, useEffect, useRef, useState } from 'react'
import { words, type Word } from './data/words'
import {
  advanceEncounter,
  clearReencounterQueue,
  createEncounterSession,
  reserveReencounter,
  retreatEncounter,
  startEncounter,
  type EncounterSession,
} from './lib/encounterEngine'
import {
  completeExpedition,
  createIdleExpedition,
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
import './App.css'

const speedPresets = [
  { label: '超高速', seconds: 0.25 },
  { label: '高速', seconds: 0.5 },
  { label: '標準', seconds: 1 },
  { label: 'ゆっくり', seconds: 2 },
]

const wordIds = words.map((word) => word.id)
const wordById = new Map(words.map((word) => [word.id, word]))
const attentionFeedbackMilliseconds = 1200
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
  const sessionRef = useRef<EncounterSession>(session)
  const expeditionRef = useRef<ExpeditionState>(expedition)
  const playerProgressRef = useRef<PlayerProgress>(playerProgress)
  // 起動直後（sequence 0）は待機画面で単語を表示しないため、記録済みとして扱う。
  const recordedSequenceRef = useRef<number | undefined>(session.current.sequence)
  const attentionSequenceRef = useRef<number | undefined>(undefined)
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
  const currentIndex = words.indexOf(currentWord)
  const currentProgress = getWordProgress(progress, currentWord.id)
  const intervalMilliseconds = intervalSeconds * 1000
  const speedLabel = intervalSeconds.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')

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
  const showEncounter = useCallback((nextSession: EncounterSession) => {
    const nextExpedition = recordExpeditionEncounter(expeditionRef.current, nextSession.current)
    const reachedLimit = hasReachedExpeditionLimit(nextExpedition)
    const settledSession = reachedLimit ? clearReencounterQueue(nextSession) : nextSession

    expeditionRef.current = nextExpedition
    sessionRef.current = settledSession
    setExpedition(nextExpedition)
    setSession(settledSession)

    if (reachedLimit) {
      setIsLooping(false)
    }
  }, [])

  const changeWord = useCallback(
    (direction: 'next' | 'previous') => {
      // 遠征中以外は単語を進めない（105 Encounter を超えない）。
      if (!isExpeditionRunning(expeditionRef.current)) {
        return
      }

      const context = { progress: latestProgressRef.current }
      const nextSession =
        direction === 'next'
          ? advanceEncounter(sessionRef.current, wordIds, context)
          : retreatEncounter(sessionRef.current, context)
      // 「前へ」で戻れる語がない場合は何もしない。
      if (nextSession === sessionRef.current) {
        return
      }
      showEncounter(nextSession)

      const nextWord = wordById.get(nextSession.current.wordId)
      if (speechEnabled && nextWord !== undefined) {
        speak(nextWord.english)
      }
    },
    [showEncounter, speechEnabled, speak],
  )

  const beginExpedition = () => {
    const nextExpedition = startExpedition()
    expeditionRef.current = nextExpedition
    // 開始時点ではなく、最初の単語を表示した時点で1 Encounter目として数える。
    const nextSession = startEncounter(sessionRef.current, wordIds, {
      progress: latestProgressRef.current,
    })
    showEncounter(nextSession)

    const nextWord = wordById.get(nextSession.current.wordId)
    if (speechEnabled && nextWord !== undefined) {
      speak(nextWord.english)
    }
  }

  const finishExpedition = () => {
    cancelSpeech()
    const nextExpedition = returnFromExpedition(expeditionRef.current)
    expeditionRef.current = nextExpedition
    setExpedition(nextExpedition)
  }

  const requestReencounter = () => {
    if (!isExpeditionRunning(expeditionRef.current)) {
      return
    }

    const encounter = sessionRef.current.current
    const word = wordById.get(encounter.wordId)
    if (word === undefined) {
      return
    }

    // 同じ表示中の連打は1回の意思表示として数える。
    if (attentionSequenceRef.current !== encounter.sequence) {
      attentionSequenceRef.current = encounter.sequence
      setProgress((current) => recordAttention(current, word.id))
    }

    const nextSession = reserveReencounter(sessionRef.current, word.id)
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
    if (!isLooping) {
      return
    }

    const timerId = window.setInterval(() => changeWord('next'), intervalMilliseconds)
    return () => window.clearInterval(timerId)
  }, [changeWord, intervalMilliseconds, isLooping])

  // 105語目を他の語と同じ時間（設定速度ぶん）画面に見せてから帰還画面へ切り替える。
  // Effect はその表示が描画された後に動くため、最後の単語が見えないまま完了することはない。
  useEffect(() => {
    if (!hasReachedExpeditionLimit(expedition)) {
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
    }, intervalMilliseconds)
    return () => window.clearTimeout(timerId)
  }, [expedition, intervalMilliseconds])

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

  return (
    <main className="word-loop">
      <header className="app-header">
        <div className="progress">
          {(expedition.status === 'running' || expedition.status === 'completed') && (
            <p
              className="expedition-progress"
              aria-label={`遠征 ${expedition.encounterCount} / ${expedition.encounterLimit} Encounter`}
            >
              遠征 {expedition.encounterCount} / {expedition.encounterLimit}
            </p>
          )}
          <p aria-label={`${currentIndex + 1}語目、全${words.length}語`}>
            単語 {currentIndex + 1} / {words.length}
          </p>
        </div>

        <div className="speech-controls">
          <button
            type="button"
            className="speech-button"
            onClick={() => speak(currentWord.english)}
            disabled={!speechSupported || !speechEnabled}
            aria-label={`${currentWord.english}を再生`}
          >
            再生
          </button>
          <button
            type="button"
            className="speech-button speech-toggle"
            onClick={toggleSpeech}
            disabled={!speechSupported}
            aria-pressed={speechEnabled}
          >
            音声 {speechEnabled ? 'ON' : 'OFF'}
          </button>
          <button
            type="button"
            className="speech-button phrase-toggle"
            onClick={() => setShowPhrase((visible) => !visible)}
            aria-pressed={showPhrase}
          >
            補助文 {showPhrase ? 'ON' : 'OFF'}
          </button>
        </div>
      </header>

      {!speechSupported && (
        <p className="speech-notice" role="status">
          このブラウザでは音声再生を利用できません。
        </p>
      )}

      {expedition.status === 'idle' && (
        <section className="expedition-panel" aria-label="遠征の待機">
          <p className="expedition-title">待機中</p>
          <p>{expedition.encounterLimit} Encounter で1回の遠征です。</p>
          {playerProgress.completedExpeditions > 0 && (
            <p className="expedition-note">
              累積XP {playerProgress.totalXp} · 所持Gold {playerProgress.gold} · 完了遠征{' '}
              {playerProgress.completedExpeditions}
            </p>
          )}
          <button type="button" className="expedition-button" onClick={beginExpedition}>
            遠征を開始
          </button>
        </section>
      )}

      {expedition.status === 'completed' && expedition.rewards !== null && (
        <section className="expedition-panel" aria-label="遠征の結果" role="status">
          <p className="expedition-title">遠征完了</p>
          <dl className="expedition-result">
            <dt>Encounter</dt>
            <dd>{expedition.encounterCount}</dd>
            <dt>Familiar</dt>
            <dd>{expedition.familiarCount}</dd>
            <dt>Growth</dt>
            <dd>{expedition.growthCount}</dd>
            <dt>Re-encounter</dt>
            <dd>{expedition.reencounterCount}</dd>
          </dl>
          <dl className="expedition-result expedition-rewards">
            <dt>XP</dt>
            <dd>{expedition.rewards.xp}</dd>
            <dt>Gold</dt>
            <dd>{expedition.rewards.gold}</dd>
          </dl>
          <button type="button" className="expedition-button" onClick={finishExpedition}>
            帰還する
          </button>
        </section>
      )}

      {expedition.status === 'returned' && expedition.rewards !== null && (
        <section className="expedition-panel" aria-label="帰還" role="status">
          <p className="expedition-title">帰還</p>
          <p>
            {expedition.encounterCount} 語に出会い、無事に帰還しました。
          </p>
          <div className="return-summary">
            <p className="return-label">今回の獲得</p>
            <dl className="expedition-result expedition-rewards">
              <dt>XP</dt>
              <dd>+{expedition.rewards.xp}</dd>
              <dt>Gold</dt>
              <dd>+{expedition.rewards.gold}</dd>
            </dl>
          </div>
          <div className="return-summary">
            <p className="return-label">これまでの成長</p>
            <dl className="expedition-result">
              <dt>累積XP</dt>
              <dd>{playerProgress.totalXp}</dd>
              <dt>所持Gold</dt>
              <dd>{playerProgress.gold}</dd>
              <dt>完了遠征</dt>
              <dd>{playerProgress.completedExpeditions}</dd>
            </dl>
          </div>
          <button type="button" className="expedition-button" onClick={beginExpedition}>
            次の遠征へ
          </button>
        </section>
      )}

      {expedition.status === 'running' && (
        <section className="word-card" aria-live="polite">
          <button
            type="button"
            className="reencounter-button"
            onClick={requestReencounter}
            aria-label={`${currentWord.english}をもう一度出す`}
          />

          {attentionFeedback !== null && (
            <p className="reencounter-feedback" role="status">
              {attentionFeedback.english} をもう一度出します
            </p>
          )}

          <div className="image-area" role="img" aria-label={currentWord.image.alt}>
            <span aria-hidden="true">{currentWord.image.placeholder}</span>
          </div>

          <div className="word-copy">
            <h1>{currentWord.english}</h1>
            <p className="translation">{currentWord.japanese}</p>
            {showPhrase && <p className="phrase">{currentWord.phrase}</p>}
          </div>
        </section>
      )}

      <div className="controls-panel">
        <section className="loop-controls" aria-label="自動周回の設定">
          <button
            type="button"
            className="loop-toggle"
            onClick={() => setIsLooping((looping) => !looping)}
            disabled={!isExpeditionRunning(expedition)}
            aria-pressed={isLooping}
          >
            {isLooping ? '停止' : '自動周回を開始'}
          </button>

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

          <div className="speed-presets" aria-label="速度プリセット">
            {speedPresets.map((preset) => (
              <button
                type="button"
                key={preset.label}
                className={intervalSeconds === preset.seconds ? 'is-selected' : undefined}
                onClick={() => setIntervalSeconds(preset.seconds)}
                aria-pressed={intervalSeconds === preset.seconds}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </section>

        <nav className="word-navigation" aria-label="単語の移動">
          <button
            type="button"
            onClick={() => changeWord('previous')}
            disabled={!isExpeditionRunning(expedition)}
          >
            前へ
          </button>
          <button
            type="button"
            onClick={() => changeWord('next')}
            disabled={!isExpeditionRunning(expedition)}
          >
            次へ
          </button>
        </nav>
      </div>

      <p className="dev-stats" aria-label="開発確認用の表示">
        開発用 · Encounter: {currentProgress.encounterCount} · Attention:{' '}
        {currentProgress.attentionCount} · 再遭遇予約: {session.reencounterQueue.length}
        {session.current.source === 'reencounter' ? ' · 再遭遇中' : ` · ${session.current.bucket}`}
        {expedition.status === 'running' &&
          ` · F/G/R: ${expedition.familiarCount}/${expedition.growthCount}/${expedition.reencounterCount} · XP: ${expedition.xp}`}
      </p>
    </main>
  )
}

export default App
