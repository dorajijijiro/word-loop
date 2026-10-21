export type Word = {
  id: string
  english: string
  japanese: string
  phrase: string
  // Recall Encounter で英語を隠して出す、日本語の短い概念Cue（1〜2行、改行は \n）。
  // 辞書的な定義ではなく、場面・意図・対比・感覚を思い浮かべやすい説明にする。すべて自作。
  // 未設定の語は Recall の対象にしない。
  recallCue?: string
  image: {
    id: string
    placeholder: string
    alt: string
  }
}

export const words: Word[] = [
  { id: 'apple', english: 'apple', japanese: 'りんご', phrase: 'A red apple.', recallCue: '赤や緑の丸い果物。\n手に持ってかじる場面。', image: { id: 'apple', placeholder: '🍎', alt: 'りんごの表示領域' } },
  { id: 'dog', english: 'dog', japanese: '犬', phrase: 'A happy dog.', recallCue: 'しっぽを振りながら\n散歩についてくる動物。', image: { id: 'dog', placeholder: '🐶', alt: '犬の表示領域' } },
  { id: 'cat', english: 'cat', japanese: '猫', phrase: 'A small cat.', recallCue: '日なたで丸くなって眠る、\n気まぐれな小さい動物。', image: { id: 'cat', placeholder: '🐱', alt: '猫の表示領域' } },
  { id: 'water', english: 'water', japanese: '水', phrase: 'Drink some water.', recallCue: 'のどが渇いたときに飲む、\n透明な液体。', image: { id: 'water', placeholder: '💧', alt: '水の表示領域' } },
  { id: 'sun', english: 'sun', japanese: '太陽', phrase: 'The bright sun.', recallCue: '昼の空でまぶしく光り、\n体をあたためてくれるもの。', image: { id: 'sun', placeholder: '☀️', alt: '太陽の表示領域' } },
  { id: 'book', english: 'book', japanese: '本', phrase: 'Read this book.', recallCue: 'ページをめくりながら\n文字を読み進めるもの。', image: { id: 'book', placeholder: '📘', alt: '本の表示領域' } },
  { id: 'car', english: 'car', japanese: '車', phrase: 'A blue car.', recallCue: '道路を走り、\n人を乗せて遠くへ運ぶもの。', image: { id: 'car', placeholder: '🚗', alt: '車の表示領域' } },
  { id: 'tree', english: 'tree', japanese: '木', phrase: 'A tall tree.', recallCue: '地面に根を張り、\n枝と葉を広げて高く伸びるもの。', image: { id: 'tree', placeholder: '🌳', alt: '木の表示領域' } },
  { id: 'house', english: 'house', japanese: '家', phrase: 'A warm house.', recallCue: '家族が暮らし、\n一日の終わりに帰ってくる場所。', image: { id: 'house', placeholder: '🏠', alt: '家の表示領域' } },
  { id: 'hand', english: 'hand', japanese: '手', phrase: 'Raise your hand.', recallCue: '物をつかんだり、\n振ってあいさつしたりする体の部分。', image: { id: 'hand', placeholder: '✋', alt: '手の表示領域' } },
  { id: 'bird', english: 'bird', japanese: '鳥', phrase: 'A little bird.', recallCue: '翼を広げて空を飛び、\n木の上でさえずる生き物。', image: { id: 'bird', placeholder: '🐦', alt: '鳥の表示領域' } },
  { id: 'fish', english: 'fish', japanese: '魚', phrase: 'A silver fish.', recallCue: '水の中をひれで泳ぐ、\nうろこのある生き物。', image: { id: 'fish', placeholder: '🐟', alt: '魚の表示領域' } },
  { id: 'flower', english: 'flower', japanese: '花', phrase: 'A yellow flower.', recallCue: '庭や野原で色とりどりに咲き、\nいい香りがするもの。', image: { id: 'flower', placeholder: '🌼', alt: '花の表示領域' } },
  { id: 'moon', english: 'moon', japanese: '月', phrase: 'The full moon.', recallCue: '夜空に浮かび、\n日ごとに満ちたり欠けたりするもの。', image: { id: 'moon', placeholder: '🌙', alt: '月の表示領域' } },
  { id: 'chair', english: 'chair', japanese: '椅子', phrase: 'Sit on chair.', recallCue: '机の前に置いて、\n腰をおろすもの。', image: { id: 'chair', placeholder: '🪑', alt: '椅子の表示領域' } },
  { id: 'shoe', english: 'shoe', japanese: '靴', phrase: 'A soft shoe.', recallCue: '外を歩くとき、\n足を守るために履くもの。', image: { id: 'shoe', placeholder: '👟', alt: '靴の表示領域' } },
  { id: 'cup', english: 'cup', japanese: 'カップ', phrase: 'A blue cup.', recallCue: '温かい飲み物を入れて、\n持ち手をつかんで飲むもの。', image: { id: 'cup', placeholder: '☕', alt: 'カップの表示領域' } },
  { id: 'door', english: 'door', japanese: 'ドア', phrase: 'Open the door.', recallCue: '部屋に入ったり出たりするときに\n開け閉めするもの。', image: { id: 'door', placeholder: '🚪', alt: 'ドアの表示領域' } },
  { id: 'bread', english: 'bread', japanese: 'パン', phrase: 'Fresh warm bread.', recallCue: '朝ごはんに焼いてバターを塗る、\n小麦からつくる食べもの。', image: { id: 'bread', placeholder: '🍞', alt: 'パンの表示領域' } },
  { id: 'rain', english: 'rain', japanese: '雨', phrase: 'Rain is falling.', recallCue: '空から水滴が降っていて、\n傘をさす場面。', image: { id: 'rain', placeholder: '🌧️', alt: '雨の表示領域' } },
]
