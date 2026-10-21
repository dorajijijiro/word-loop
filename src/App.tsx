import { useCallback, useEffect, useRef, useState } from 'react'
import { words, type Word } from './data/words'
import {
  advanceEncounter,
  createEncounterSession,
  reserveReencounter,
  retreatEncounter,
  type EncounterSession,
} from './lib/encounterEngine'
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
  const initialIndex = Math.max(
    0,
    words.findIndex((word) => word.id === initialState.currentWordId),
  )
  const [session, setSession] = useState(() => createEncounterSession(wordIds, initialIndex))
  const [progress, setProgress] = useState(loadLearningProgress)
  const [attentionFeedback, setAttentionFeedback] = useState<Word | null>(null)
  const [speechEnabled, setSpeechEnabled] = useState(initialState.speechEnabled)
  const [showPhrase, setShowPhrase] = useState(initialState.showPhrase)
  const [isLooping, setIsLooping] = useState(false)
  const [intervalSeconds, setIntervalSeconds] = useState(initialState.intervalSeconds)
  const sessionRef = useRef<EncounterSession>(session)
  const recordedSequenceRef = useRef<number | undefined>(undefined)
  const attentionSequenceRef = useRef<number | undefined>(undefined)
  const feedbackTimerRef = useRef<number | undefined>(undefined)
  const pendingProgressSaveRef = useRef<number | undefined>(undefined)
  const latestProgressRef = useRef<LearningProgressMap>(progress)
  const pendingSaveRef = useRef<number | undefined>(undefined)
  const latestStateRef = useRef<LearningState>({
    currentWordId: words[initialIndex].id,
    intervalSeconds: initialState.intervalSeconds,
    speechEnabled: initialState.speechEnabled,
    showPhrase: initialState.showPhrase,
  })
  const speechSupported =
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    'SpeechSynthesisUtterance' in window
  const currentIndex = session.normalIndex
  // 再起動時の再開位置は通常周回側の単語にする。
  const normalWord = words[currentIndex]
  const currentWord = wordById.get(session.current.wordId) ?? normalWord
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

  const changeWord = useCallback(
    (direction: 'next' | 'previous') => {
      const nextSession =
        direction === 'next'
          ? advanceEncounter(sessionRef.current, wordIds)
          : retreatEncounter(sessionRef.current, wordIds)
      sessionRef.current = nextSession
      setSession(nextSession)

      const nextWord = wordById.get(nextSession.current.wordId)
      if (speechEnabled && nextWord !== undefined) {
        speak(nextWord.english)
      }
    },
    [speechEnabled, speak],
  )

  const requestReencounter = () => {
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
      currentWordId: normalWord.id,
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
  }, [normalWord.id, intervalSeconds, showPhrase, speechEnabled])

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
        <p className="progress" aria-label={`${currentIndex + 1}語目、全${words.length}語`}>
          {currentIndex + 1} / {words.length}
        </p>

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

      <div className="controls-panel">
        <section className="loop-controls" aria-label="自動周回の設定">
          <button
            type="button"
            className="loop-toggle"
            onClick={() => setIsLooping((looping) => !looping)}
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
          <button type="button" onClick={() => changeWord('previous')}>
            前へ
          </button>
          <button type="button" onClick={() => changeWord('next')}>
            次へ
          </button>
        </nav>
      </div>

      <p className="dev-stats" aria-label="開発確認用の表示">
        開発用 · Encounter: {currentProgress.encounterCount} · Attention:{' '}
        {currentProgress.attentionCount} · 再遭遇予約: {session.reencounterQueue.length}
        {session.current.source === 'reencounter' && ' · 再遭遇中'}
      </p>
    </main>
  )
}

export default App
