// Global variables
const localStream = null;
const peerConnections = {}; // Store peer connections
const signalingRef = firebase.firestore().collection('signaling'); // Firestore reference for signaling
const roomId = "sampleRoomId"; // Use an actual room ID or dynamically set it

// Get local audio stream
async function getLocalAudioStream() {
    const constraints = { audio: true, video: false };
    return await navigator.mediaDevices.getUserMedia(constraints);
}

// Create peer connections for all participants
async function createPeerConnections(roomId, localStream) {
    const roomRef = firebase.firestore().collection('rooms').doc(roomId);
    const roomDoc = await roomRef.get();
    const participants = roomDoc.data().participants;

    // Create peer connection for each participant
    for (const [userId, participantData] of Object.entries(participants)) {
        const pc = new RTCPeerConnection();
        peerConnections[userId] = pc;

        // Add local stream to peer connection
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

        // Handle ICE candidates
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                sendICECandidate(userId, event.candidate);
            }
        };

        // Handle incoming audio streams
        pc.ontrack = (event) => {
            const remoteAudioStream = event.streams[0];
            addRemoteAudio(userId, remoteAudioStream);
        };

        // Send an offer to every other participant
        if (userId !== myUserId) {
            await createOfferForPeer(userId, pc);
        }
    }
}

// Add remote audio element dynamically
function addRemoteAudio(userId, stream) {
    const audioElement = document.createElement('audio');
    audioElement.id = `audio-${userId}`;
    audioElement.srcObject = stream;
    audioElement.autoplay = true;
    document.getElementById('audios').appendChild(audioElement);
}

// Send signaling messages (offers, answers, ICE candidates)
async function sendSignalingMessage(userId, message) {
    await signalingRef.doc(userId).set(message);
}

// Create an SDP offer for a peer
async function createOfferForPeer(userId, pc) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    sendSignalingMessage(userId, { type: 'offer', offer });
}

// Handle incoming signaling messages (offers, answers, ICE candidates)
signalingRef.onSnapshot(async (snapshot) => {
    snapshot.docChanges().forEach(async (change) => {
        const message = change.doc.data();
        const userId = change.doc.id;

        if (message.type === 'offer') {
            await handleOffer(userId, message.offer);
        } else if (message.type === 'answer') {
            await handleAnswer(userId, message.answer);
        } else if (message.type === 'candidate') {
            await handleICECandidate(userId, message.candidate);
        }
    });
});

// Handle the offer and create an answer
async function handleOffer(userId, offer) {
    const pc = peerConnections[userId];
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    sendSignalingMessage(userId, { type: 'answer', answer });
}

// Handle the answer from a peer
async function handleAnswer(userId, answer) {
    const pc = peerConnections[userId];
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
}

// Handle ICE candidates
async function handleICECandidate(userId, candidate) {
    const pc = peerConnections[userId];
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
}

// Send ICE candidates to Firebase
async function sendICECandidate(userId, candidate) {
    await signalingRef.doc(userId).set({
        type: 'candidate',
        candidate
    });
}

// Create Room button
document.getElementById('createBtn').addEventListener('click', async () => {
    const localStream = await getLocalAudioStream();
    await createPeerConnections(roomId, localStream);
    document.getElementById('createBtn').disabled = true;
    document.getElementById('joinBtn').disabled = false;
});

// Join Room button
document.getElementById('joinBtn').addEventListener('click', () => {
    document.getElementById('roomIdInput').style.display = 'block';
});

document.getElementById('joinRoomBtn').addEventListener('click', async () => {
    const roomId = document.getElementById('room-id').value;
    const localStream = await getLocalAudioStream();
    await createPeerConnections(roomId, localStream);
    document.getElementById('roomIdInput').style.display = 'none';
    document.getElementById('hangupBtn').disabled = false;
});

// Hangup button to close all peer connections
document.getElementById('hangupBtn').addEventListener('click', () => {
    for (const userId in peerConnections) {
        peerConnections[userId].close();
    }
    document.getElementById('audios').innerHTML = '';  // Clear audio elements
    document.getElementById('hangupBtn').disabled = true;
});
