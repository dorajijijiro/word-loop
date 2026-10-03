export type Word = {
  id: string
  english: string
  japanese: string
  phrase: string
  image: {
    id: string
    placeholder: string
    alt: string
  }
}

export const words: Word[] = [
  { id: 'apple', english: 'apple', japanese: 'りんご', phrase: 'A red apple.', image: { id: 'apple', placeholder: '🍎', alt: 'りんごの表示領域' } },
  { id: 'dog', english: 'dog', japanese: '犬', phrase: 'A happy dog.', image: { id: 'dog', placeholder: '🐶', alt: '犬の表示領域' } },
  { id: 'cat', english: 'cat', japanese: '猫', phrase: 'A small cat.', image: { id: 'cat', placeholder: '🐱', alt: '猫の表示領域' } },
  { id: 'water', english: 'water', japanese: '水', phrase: 'Drink some water.', image: { id: 'water', placeholder: '💧', alt: '水の表示領域' } },
  { id: 'sun', english: 'sun', japanese: '太陽', phrase: 'The bright sun.', image: { id: 'sun', placeholder: '☀️', alt: '太陽の表示領域' } },
  { id: 'book', english: 'book', japanese: '本', phrase: 'Read this book.', image: { id: 'book', placeholder: '📘', alt: '本の表示領域' } },
  { id: 'car', english: 'car', japanese: '車', phrase: 'A blue car.', image: { id: 'car', placeholder: '🚗', alt: '車の表示領域' } },
  { id: 'tree', english: 'tree', japanese: '木', phrase: 'A tall tree.', image: { id: 'tree', placeholder: '🌳', alt: '木の表示領域' } },
  { id: 'house', english: 'house', japanese: '家', phrase: 'A warm house.', image: { id: 'house', placeholder: '🏠', alt: '家の表示領域' } },
  { id: 'hand', english: 'hand', japanese: '手', phrase: 'Raise your hand.', image: { id: 'hand', placeholder: '✋', alt: '手の表示領域' } },
  { id: 'bird', english: 'bird', japanese: '鳥', phrase: 'A little bird.', image: { id: 'bird', placeholder: '🐦', alt: '鳥の表示領域' } },
  { id: 'fish', english: 'fish', japanese: '魚', phrase: 'A silver fish.', image: { id: 'fish', placeholder: '🐟', alt: '魚の表示領域' } },
  { id: 'flower', english: 'flower', japanese: '花', phrase: 'A yellow flower.', image: { id: 'flower', placeholder: '🌼', alt: '花の表示領域' } },
  { id: 'moon', english: 'moon', japanese: '月', phrase: 'The full moon.', image: { id: 'moon', placeholder: '🌙', alt: '月の表示領域' } },
  { id: 'chair', english: 'chair', japanese: '椅子', phrase: 'Sit on chair.', image: { id: 'chair', placeholder: '🪑', alt: '椅子の表示領域' } },
  { id: 'shoe', english: 'shoe', japanese: '靴', phrase: 'A soft shoe.', image: { id: 'shoe', placeholder: '👟', alt: '靴の表示領域' } },
  { id: 'cup', english: 'cup', japanese: 'カップ', phrase: 'A blue cup.', image: { id: 'cup', placeholder: '☕', alt: 'カップの表示領域' } },
  { id: 'door', english: 'door', japanese: 'ドア', phrase: 'Open the door.', image: { id: 'door', placeholder: '🚪', alt: 'ドアの表示領域' } },
  { id: 'bread', english: 'bread', japanese: 'パン', phrase: 'Fresh warm bread.', image: { id: 'bread', placeholder: '🍞', alt: 'パンの表示領域' } },
  { id: 'rain', english: 'rain', japanese: '雨', phrase: 'Rain is falling.', image: { id: 'rain', placeholder: '🌧️', alt: '雨の表示領域' } },
]
