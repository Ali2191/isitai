document.getElementById('go').addEventListener('click', () => {
  const u = document.getElementById('u').value.trim()
  const url = u ? `https://isitai-gilt.vercel.app/?url=${encodeURIComponent(u)}&auto=1&source=extension` : 'https://isitai-gilt.vercel.app/?source=extension'
  chrome.tabs.create({ url })
})
