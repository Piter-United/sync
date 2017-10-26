const firebase = require('firebase-admin');
const google = require('googleapis');
const GoogleAuth = require('google-auth-library');

const drive = google.drive('v3');
const sheets = google.sheets('v4').spreadsheets;

const secrets = require(process.env.SECRET_FILE || './secrets.json');
const list = require('./sheets.json');

firebase.initializeApp({
  credential: firebase.credential.cert(secrets.firebase),
  databaseURL: 'https://piter-united-8b948.firebaseio.com',
});


const googleAuth = new GoogleAuth();
const auth = new googleAuth.OAuth2(secrets.google.clientId, secrets.google.clientSecret, secrets.google.redirectUrl);
auth.credentials = secrets.google.token;

async function getLastUpdate(fileId) {
  const options = {
    auth,
    fileId,
    fields: ['modifiedTime'],
  };
  const data = await new Promise((resolve, reject) => {
    drive.files.get(options, null, (err, res) => {
      if (err) return reject(err);
      return resolve(res);
    });
  });
  return data.modifiedTime;
}


function formatTable(values) {
  const program = [];
  let prevCommunity = null;
  values.forEach((row) => {
    let c = (row[0] !== undefined) ? row[0].trim() : null;
    if (c === '') {
      c = prevCommunity;
    }
    prevCommunity = c;
    const speaker = {
      time: (row[1] !== undefined) ? row[1].trim() : null,
      speaker: (row[2] !== undefined) ? row[2].trim() : null,
      company: (row[3] !== undefined) ? row[3].trim() : null,
      subject: (row[4] !== undefined) ? row[4].trim() : null,
      description: (row[5] !== undefined) ? row[5].trim() : null,
      // TODO create download speaker photo and upload to firebase storage
      // (row[7] !== undefined && row[7] !== null) ? row[7].trim() : null
      photo: null,
    };
    let community = program.find(p => p.community === c);
    if (!community) {
      community = {
        community: c,
        program: [speaker],
      };
      program.push(community);
    } else {
      community.program.push(speaker);
    }
    community.program = community.program.sort((a, b) => {
      if (a.time < b.time) return -1;
      if (a.time > b.time) return 1;
      return 0;
    });
  });
  return program;
}

async function getTableData(spreadsheetId) {
  const options = {
    spreadsheetId,
    range: 'C2:J',
    auth,
  };
  const data = await new Promise((resolve, reject) => {
    sheets.values.get(options, null, (err, res) => {
      if (err) return reject(err);
      return resolve(res);
    });
  });
  return (data && data.values) ? formatTable(data.values) : null;
}

async function getValues(table, sheet) {
  const snapshot = await firebase.database().ref(table).once('value');
  const value = snapshot.val();
  const lastFileUpdate = await getLastUpdate(sheet);
  let needUpdate = false;
  const data = {
    lastFileUpdate,
  };
  if (
    !value ||
      new Date(lastFileUpdate).getTime() > new Date(value.lastFileUpdate).getTime()
  ) {
    needUpdate = true;
    data.data = await getTableData(sheet);
  }
  return (needUpdate) ? firebase.database().ref(table).set(data).then(() => Promise.resolve(true)) : Promise.resolve(false);
}


function start() {
  list.reduce(
    (promise, data) =>
      promise.then(() =>
        getValues(data.table, data.sheet)
          .then(hasUpdate => console.log(data, 'hasUpdated:', hasUpdate))),
    Promise.resolve(),
  )
    .then(() => {
      console.log(new Date(), 'sync end');
      setTimeout(() => start(), 1000 * 60 * 30);
    })
    .catch((err) => {
      console.error(new Date(), err);
      setTimeout(() => start(), 1000 * 60 * 30);
    });
}

start();
