const express = require('express')
const cors = require('cors')

const app = express()
const port = process.env.PORT || 4000

app.use(cors())

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' })
})

app.get('/', (req, res) => {
  res.json([
    {
      "id":"1",
      "title":"Book Review: The Bear & The Nightingale"
    },
    {
      "id":"2",
      "title":"Game Review: Pokemon Brilliant Diamond"
    },
    {
      "id":"3",
      "title":"Show Review: Breaking Bad"
    },
     {
      "id":"4",
      "title":"Movie Review: Batman Begins"
    }
  ])
})

app.listen(port, () => {
  console.log(`listening for requests on port ${port}`)
})