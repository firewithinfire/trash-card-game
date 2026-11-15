export function RulesPanel({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal rules" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Rules">
        <h2>How to play Trash 🗑️</h2>
        <ul>
          <li><b>Deal:</b> 3 face-down cards, 3 face-up on top, 4 in your hand. The rest is the stock. (6+ players use two decks.)</li>
          <li><b>Swap:</b> before the start, swap any hand cards with your face-up cards, then press <i>Ready</i>.</li>
          <li><b>Play one card per turn</b> onto the pile. It must be <b>equal or higher</b> than the last card. Order: 3 4 5 6 7 9 J Q K <b>A</b> (Ace highest).</li>
          <li><b>2</b> goes on anything and resets: anything can follow it.</li>
          <li><b>8</b> goes on anything and counts as the card under it (8 on a 9 = beat 9). On an empty pile or a 2, anything can follow. It doesn't skip anyone.</li>
          <li><b>10 = Trash!</b> Goes on anything. The whole pile (with the 10) goes to the trash for the rest of the round. The <b>next player</b> starts a new pile with any card.</li>
          <li><b>Draw:</b> after playing, draw 1 from the stock if your hand has 3 or fewer cards. So after a pickup you don't draw until you're back down to 3.</li>
          <li><b>Pick up:</b> if you can't (or don't want to) play, take the whole pile into your hand. That ends your turn.</li>
          <li><b>Face-up:</b> when your hand is empty (stock gone), play from your face-up cards. If none can beat the pile, play one anyway and pick up the pile with it, then continue from your hand.</li>
          <li><b>Face-down:</b> when hand and face-ups are gone, tap a face-down card to flip it. If it beats the pile it stays. If it's lower, you pick up the whole pile plus that flipped card into your hand (just like with face-up cards) and play from your hand again.</li>
          <li><b>Win:</b> the first player to get rid of all their cards (hand, face-up and face-down) wins, and the round ends right there.</li>
          <li><b>Bots:</b> the host can fill seats with Easy, Medium or Hard bots. They only see what a real player in that seat would see.</li>
        </ul>
        <button className="btn primary wide" onClick={onClose}>Got it</button>
      </div>
    </div>
  );
}
