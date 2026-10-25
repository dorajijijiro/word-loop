import {
  advanceEncounter,
  cancelReencounter,
  clearReencounterQueue,
  createEncounterSession,
  reserveReencounter,
  startEncounter,
  type Encounter,
  type EncounterSession,
} from '../src/lib/encounterEngine.ts'
import {
  completeExhaustedExpedition,
  completeExpedition,
  createIdleExpedition,
  hasReachedExpeditionLimit,
  recordExpeditionEncounter,
  startExpedition,
  type ExpeditionState,
} from '../src/lib/expedition.ts'
import {
  createWordProgress,
  recordEncounter,
  type LearningProgressMap,
  type WordLearningProgress,
} from '../src/lib/learningProgress.ts'
import {
  answerUnderstanding,
  type UnderstandingAnswerBases,
  type UnderstandingMap,
  type UnderstandingStatus,
} from '../src/lib/understanding.ts'

// テスト用の再現可能な乱数（線形合同法）。0以上1未満を返す。
export function seededRandom(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 2 ** 32
  }
}

// テスト用の学習進捗1語分。指定しない項目は未遭遇の初期値。
export function wordProgress(
  wordId: string,
  fields: Partial<Omit<WordLearningProgress, 'wordId'>> = {},
): WordLearningProgress {
  return { ...createWordProgress(wordId), ...fields }
}

// ---------- 遠征のシミュレーション（App と同じ処理順） ----------
// 表示 → 遠征に記録 → 進捗に Encounter を記録 → 理解度ボタン（任意）→ 次の語（候補がなければ早期終了）。
// 時刻は stepMilliseconds ずつ進める（実時間は待たない）。

export type SimulatedAnswer = UnderstandingStatus | UnderstandingStatus[] | null

export type SimulateOptions = {
  wordIds: string[]
  now: number
  seed: number
  understanding?: UnderstandingMap
  progress?: LearningProgressMap
  session?: EncounterSession
  // 表示した Encounter ごとの回答。配列なら同じ Encounter で順に押す（連打・訂正）。
  answer?: (encounter: Encounter, index: number) => SimulatedAnswer
  stepMilliseconds?: number
  // 語ごとのランクの順番（Task 018）。
  rankOrder?: ReadonlyMap<string, number>
}

export function simulateExpedition(options: SimulateOptions) {
  const random = seededRandom(options.seed)
  const step = options.stepMilliseconds ?? 1000
  let now = options.now
  let understanding = options.understanding ?? {}
  let progress = options.progress ?? {}
  let bases: UnderstandingAnswerBases = {}
  const context = () => ({ progress, understanding, now, random, rankOrder: options.rankOrder })
  const shown: Encounter[] = []

  const started = startEncounter(
    options.session ?? createEncounterSession(options.wordIds, options.wordIds[0]),
    options.wordIds,
    context(),
  )
  if (started === null) {
    return { started: false, expedition: createIdleExpedition(), shown, understanding, progress, session: null, now }
  }

  let session: EncounterSession = started
  let expedition: ExpeditionState = startExpedition()
  for (let index = 0; index < 1000; index += 1) {
    expedition = recordExpeditionEncounter(expedition, session.current)
    shown.push(session.current)
    progress = recordEncounter(progress, session.current.wordId, new Date(now).toISOString())

    const answer = options.answer?.(session.current, index) ?? null
    for (const status of answer === null ? [] : Array.isArray(answer) ? answer : [answer]) {
      const target = { wordId: session.current.wordId, sequence: session.current.sequence }
      const result = answerUnderstanding(understanding, bases, target, status, new Date(now).toISOString())
      understanding = result.map
      bases = result.bases
      session =
        status === 'unknown'
          ? reserveReencounter(session, target.wordId, target.sequence)
          : cancelReencounter(session, target.wordId)
    }

    if (hasReachedExpeditionLimit(expedition)) {
      session = clearReencounterQueue(session)
      expedition = completeExpedition(expedition)
      break
    }
    now += step
    const next = advanceEncounter(session, options.wordIds, context())
    if (next === null) {
      session = clearReencounterQueue(session)
      expedition = completeExhaustedExpedition(expedition)
      break
    }
    session = next
  }

  return { started: true, expedition, shown, understanding, progress, session, now }
}
