import { useCallback, useEffect, useRef, useState } from 'react'
import { words } from './data/words'
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

function App() {
  const [initialState] = useState(loadLearningState)
  const initialIndex = Math.max(
    0,
    words.findIndex((word) => word.id === initialState.currentWordId),
  )
  const [currentIndex, setCurrentIndex] = useState(initialIndex)
  const [speechEnabled, setSpeechEnabled] = useState(initialState.speechEnabled)
  const [showPhrase, setShowPhrase] = useState(initialState.showPhrase)
  const [isLooping, setIsLooping] = useState(false)
  const [intervalSeconds, setIntervalSeconds] = useState(initialState.intervalSeconds)
  const currentIndexRef = useRef(currentIndex)
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
  const currentWord = words[currentIndex]
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
    (offset: number) => {
      const nextIndex = (currentIndexRef.current + offset + words.length) % words.length
      currentIndexRef.current = nextIndex
      setCurrentIndex(nextIndex)

      if (speechEnabled) {
        speak(words[nextIndex].english)
      }
    },
    [speechEnabled, speak],
  )

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

    const timerId = window.setInterval(() => changeWord(1), intervalMilliseconds)
    return () => window.clearInterval(timerId)
  }, [changeWord, intervalMilliseconds, isLooping])

  useEffect(() => {
    latestStateRef.current = {
      currentWordId: currentWord.id,
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
  }, [currentWord.id, intervalSeconds, showPhrase, speechEnabled])

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
          <button type="button" onClick={() => changeWord(-1)}>
            前へ
          </button>
          <button type="button" onClick={() => changeWord(1)}>
            次へ
          </button>
        </nav>
      </div>
    </main>
  )
}

export default App
