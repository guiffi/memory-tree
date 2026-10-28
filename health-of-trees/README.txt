HEALTH OF TREES — how to test

1. Open Terminal (Cmd + Space, type Terminal, Enter).
2. Type  cd  followed by a space, drag this folder into the Terminal window, press Enter.
3. First time only:      npm install
4. Start the server:     npm start
   Leave this window open. It says: Health of Trees on http://localhost:3000
5. Open http://localhost:3000 in your browser and allow the location request.
   To see the memory file live: http://localhost:3000/memory.txt

To let other people join for an hour, open a second Terminal window (Cmd + N):
   brew install cloudflared                          (first time only)
   cloudflared tunnel --url http://localhost:3000
Send them the https://....trycloudflare.com link it prints.

Files
- burning-memory.html   the website (tree of text rings)
- server.js             the live server (Socket.IO) and the memory
- memory.txt            the memory of the website: starts blank, one line per visitor,
                        burned words are deleted from it
- package.json          what npm install needs

To start over with an empty tree: stop the server (Ctrl + C), empty memory.txt, npm start again.
