// Attach ripple effect to MDC buttons
mdc.ripple.MDCRipple.attachTo(document.querySelector('.mdc-button'));

// Default configuration for STUN/TURN servers
const configuration = {
  iceServers: [
    {
      urls: [
        'stun:stun1.l.google.com:19302',
        'stun:stun2.l.google.com:19302',
      ],
    },
  ],
  iceCandidatePoolSize: 10,
};

let peerConnection = null;
let localStream = null;
let remoteStream = null;
let roomDialog = null;
let roomId = null;

function init() {
  // Attach event listeners for buttons
  document.querySelector('#cameraBtn').addEventListener('click', openUserMedia);
  document.querySelector('#hangupBtn').addEventListener('click', hangUp);
  document.querySelector('#createBtn').addEventListener('click', createRoom);
  document.querySelector('#joinBtn').addEventListener('click', joinRoom);

  // Initialize MDC dialog component
  roomDialog = new mdc.dialog.MDCDialog(document.querySelector('#room-dialog'));
}

// Function to create a new room and set up WebRTC connections
async function createRoom() {
  document.querySelector('#createBtn').disabled = true;
  document.querySelector('#joinBtn').disabled = true;
  const db = firebase.firestore();

  console.log('Create PeerConnection with configuration: ', configuration);
  peerConnection = new RTCPeerConnection(configuration);
  registerPeerConnectionListeners();

  // Add local stream tracks to the peer connection
  localStream.getTracks().forEach(track => {
    peerConnection.addTrack(track, localStream);
  });

  // Create an offer and set it as the local description
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);

  // Save the room and offer in Firebase Firestore
  const roomRef = db.collection('rooms').doc();
  await roomRef.set({
    offer: offer,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  });

  roomId = roomRef.id;
  console.log('Room created with ID:', roomId);
  document.querySelector('#currentRoom').innerText = `Room ID: ${roomId}`;

  // Collect ICE candidates and store them in Firestore
  peerConnection.onicecandidate = async (event) => {
    if (event.candidate) {
      await roomRef.collection('callerCandidates').add(event.candidate.toJSON());
    }
  };
}

// Function to join an existing room by ID
function joinRoom() {
  document.querySelector('#createBtn').disabled = true;
  document.querySelector('#joinBtn').disabled = true;

  document.querySelector('#confirmJoinBtn').addEventListener('click', async () => {
    roomId = document.querySelector('#room-id').value;
    console.log('Join room: ', roomId);
    document.querySelector('#currentRoom').innerText = `Current room is ${roomId} - You are the callee!`;
    await joinRoomById(roomId);
  }, {once: true});
  
  roomDialog.open();
}

// Function to join a specific room by ID
async function joinRoomById(roomId) {
  const db = firebase.firestore();
  const roomRef = db.collection('rooms').doc(roomId);
  const roomSnapshot = await roomRef.get();
  console.log('Got room:', roomSnapshot.exists);

  if (roomSnapshot.exists) {
    console.log('Create PeerConnection with configuration: ', configuration);
    peerConnection = new RTCPeerConnection(configuration);
    registerPeerConnectionListeners();

    // Add local stream tracks to the peer connection
    localStream.getTracks().forEach(track => {
      peerConnection.addTrack(track, localStream);
    });

    // Collect ICE candidates for the callee
    peerConnection.onicecandidate = async (event) => {
      if (event.candidate) {
        await roomRef.collection('calleeCandidates').add(event.candidate.toJSON());
      }
    };

    // Handle offer and create an SDP answer
    const offer = roomSnapshot.data().offer;
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));

    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    // Save the answer to the room
    await roomRef.update({ answer: answer });

    peerConnection.addEventListener('track', event => {
      console.log('Got remote track:', event.streams[0]);
      event.streams[0].getTracks().forEach(track => {
        console.log('Add a track to the remoteStream:', track);
        remoteStream.addTrack(track);
      });
    });

    // Listen for ICE candidates from the remote peer
    const callerCandidatesSnapshot = await roomRef.collection('callerCandidates').get();
    callerCandidatesSnapshot.forEach(candidateDoc => {
      const candidate = new RTCIceCandidate(candidateDoc.data());
      peerConnection.addIceCandidate(candidate);
    });
  }
}

// Function to request user media permissions
async function openUserMedia(e) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true
    });
    document.querySelector('#localVideo').srcObject = stream;
    localStream = stream;
    remoteStream = new MediaStream();
    document.querySelector('#remoteVideo').srcObject = remoteStream;

    console.log('Stream:', document.querySelector('#localVideo').srcObject);
    document.querySelector('#cameraBtn').disabled = true;
    document.querySelector('#joinBtn').disabled = false;
    document.querySelector('#createBtn').disabled = false;
    document.querySelector('#hangupBtn').disabled = false;
  } catch (error) {
    console.error('Error accessing media devices.', error);
    alert('Unable to access camera and microphone. Please check your browser settings.');
  }
}

// Function to hang up the call and clean up resources
async function hangUp(e) {
  const tracks = document.querySelector('#localVideo').srcObject.getTracks();
  tracks.forEach(track => {
    track.stop();
  });

  if (remoteStream) {
    remoteStream.getTracks().forEach(track => track.stop());
  }

  if (peerConnection) {
    peerConnection.close();
  }

  document.querySelector('#localVideo').srcObject = null;
  document.querySelector('#remoteVideo').srcObject = null;
  document.querySelector('#cameraBtn').disabled = false;
  document.querySelector('#joinBtn').disabled = true;
  document.querySelector('#createBtn').disabled = true;
  document.querySelector('#hangupBtn').disabled = true;
  document.querySelector('#currentRoom').innerText = '';

  // Delete room data on hangup
  if (roomId) {
    const db = firebase.firestore();
    const roomRef = db.collection('rooms').doc(roomId);
    const calleeCandidates = await roomRef.collection('calleeCandidates').get();
    calleeCandidates.forEach(async candidate => {
      await candidate.delete();
    });
    const callerCandidates = await roomRef.collection('callerCandidates').get();
    callerCandidates.forEach(async candidate => {
      await candidate.delete();
    });
    await roomRef.delete();
  }

  document.location.reload(true);
}

// Register connection event listeners
function registerPeerConnectionListeners() {
  peerConnection.addEventListener('icegatheringstatechange', () => {
    console.log(`ICE gathering state changed: ${peerConnection.iceGatheringState}`);
  });

  peerConnection.addEventListener('connectionstatechange', () => {
    console.log(`Connection state change: ${peerConnection.connectionState}`);
  });

  peerConnection.addEventListener('signalingstatechange', () => {
    console.log(`Signaling state change: ${peerConnection.signalingState}`);
  });

  peerConnection.addEventListener('iceconnectionstatechange', () => {
    console.log(`ICE connection state change: ${peerConnection.iceConnectionState}`);
  });
}

// Initialize the app
init();
