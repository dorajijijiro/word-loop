import { useEffect, useState } from 'react'
import App from './App.tsx'
import { AudioPreview } from './AudioPreview.tsx'

// Task 019: #audio-preview のときだけ試聴画面を出す（本体の画面・保存データとは独立）
const audioPreviewHash = '#audio-preview'

export function Root() {
  const [hash, setHash] = useState(() => window.location.hash)

  useEffect(() => {
    const updateHash = () => {
      setHash(window.location.hash)
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', updateHash)
    return () => window.removeEventListener('hashchange', updateHash)
  }, [])

  return hash === audioPreviewHash ? <AudioPreview /> : <App />
}
