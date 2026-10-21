// 次に表示する単語（Encounter）を決めるロジック。
// 現在は「通常周回」と「再遭遇」の2種類だけを扱う。
// 将来 Growth語・Rare語などを加える場合は advanceEncounter の選出部分を拡張する。

// タップした単語を何Encounter後に再登場させるか（MVPでは固定値）。
export const reencounterDelay = 5

export type EncounterSource = 'normal' | 'reencounter'

export type Encounter = {
  // 起動してからの通し番号。表示が変わるたびに1増える。
  sequence: number
  wordId: string
  source: EncounterSource
}

export type ReencounterReservation = {
  wordId: string
  dueSequence: number
}

export type EncounterSession = {
  // 通常周回での現在位置。再遭遇語を表示している間も進めない。
  normalIndex: number
  current: Encounter
  // 予約順に並ぶ。dueSequence も予約順に単調増加する。
  reencounterQueue: ReencounterReservation[]
}

export function createEncounterSession(wordIds: string[], startIndex: number): EncounterSession {
  return {
    normalIndex: startIndex,
    current: { sequence: 0, wordId: wordIds[startIndex], source: 'normal' },
    reencounterQueue: [],
  }
}

export function isReencounterReserved(session: EncounterSession, wordId: string) {
  return session.reencounterQueue.some((reservation) => reservation.wordId === wordId)
}

// 自動周回・「次へ」で呼ぶ。期限が来た再遭遇予約があれば通常周回の途中へ差し込む。
export function advanceEncounter(session: EncounterSession, wordIds: string[]): EncounterSession {
  const sequence = session.current.sequence + 1
  const nextNormalIndex = (session.normalIndex + 1) % wordIds.length
  const [dueReservation, ...restQueue] = session.reencounterQueue

  if (dueReservation !== undefined && dueReservation.dueSequence <= sequence) {
    // 通常周回でちょうど同じ語が来る場合は、二重に出さず予約を消化したことにする。
    if (dueReservation.wordId !== wordIds[nextNormalIndex]) {
      return {
        normalIndex: session.normalIndex,
        current: { sequence, wordId: dueReservation.wordId, source: 'reencounter' },
        reencounterQueue: restQueue,
      }
    }

    return {
      normalIndex: nextNormalIndex,
      current: { sequence, wordId: wordIds[nextNormalIndex], source: 'normal' },
      reencounterQueue: restQueue,
    }
  }

  return {
    normalIndex: nextNormalIndex,
    current: { sequence, wordId: wordIds[nextNormalIndex], source: 'normal' },
    reencounterQueue: session.reencounterQueue,
  }
}

// 「前へ」で呼ぶ。再遭遇語の表示中なら、差し込み直前の通常語へ戻る。
// 「前へ」では再遭遇語を差し込まない（予約は次の前進時に出る）。
export function retreatEncounter(session: EncounterSession, wordIds: string[]): EncounterSession {
  const sequence = session.current.sequence + 1
  const normalIndex =
    session.current.source === 'reencounter'
      ? session.normalIndex
      : (session.normalIndex - 1 + wordIds.length) % wordIds.length

  return {
    normalIndex,
    current: { sequence, wordId: wordIds[normalIndex], source: 'normal' },
    reencounterQueue: session.reencounterQueue,
  }
}

// 表示中の単語を再遭遇対象にする。同じ wordId の予約は1件まで。
export function reserveReencounter(session: EncounterSession, wordId: string): EncounterSession {
  if (isReencounterReserved(session, wordId)) {
    return session
  }

  return {
    ...session,
    reencounterQueue: [
      ...session.reencounterQueue,
      { wordId, dueSequence: session.current.sequence + reencounterDelay },
    ],
  }
}

// 遠征開始時に呼ぶ。通常周回の現在位置の単語を新しい Encounter として表示し直す。
// 前の遠征の再遭遇予約は持ち越さない。
export function restartEncounter(session: EncounterSession, wordIds: string[]): EncounterSession {
  return {
    normalIndex: session.normalIndex,
    current: {
      sequence: session.current.sequence + 1,
      wordId: wordIds[session.normalIndex],
      source: 'normal',
    },
    reencounterQueue: [],
  }
}

// 遠征終了時に呼ぶ。未消化の再遭遇予約を破棄する。
export function clearReencounterQueue(session: EncounterSession): EncounterSession {
  return { ...session, reencounterQueue: [] }
}
