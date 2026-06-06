// @refresh reset

import { useEffect, useRef, useState } from 'react';
import * as vision from '@mediapipe/tasks-vision';

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

type Screen =
  | 'splash'
  | 'onboarding'
  | 'home'
  | 'squatIntro'
  | 'squat'
  | 'history'
  | 'progress'
  | 'profile'
  | 'profileSetup';
type CameraFacing = 'user' | 'environment';

type Stage =
  | 'Calibrando'
  | 'Aguardando corpo'
  | 'Em pé'
  | 'Descendo'
  | 'Agachado'
  | 'Subindo';

type Phase = 'waiting' | 'standing' | 'descending' | 'bottom' | 'ascending';

type RepData = {
  depth: number;
  torso: number;
  hip: number;
  speed: number;
  score: number;
  depthScore: number;
  torsoScore: number;
  hipScore: number;
  speedScore: number;
};

type SessionData = {
  exercise?: string;
  reps: number;
  averageScore: number;
  averageDepth: number;
  date: string;
};

export default function App() {
  const [screen, setScreen] = useState<Screen>('splash');
  const [introStep, setIntroStep] = useState(0);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [showEnterButton, setShowEnterButton] = useState(false);
  const loadingMessages = [
    'Inicializando IA...',
    'Carregando biomecânica...',
    'Preparando análise...',
    'Quase pronto...',
  ];

  const loadingMessage =
    loadingProgress < 30
      ? loadingMessages[0]
      : loadingProgress < 60
      ? loadingMessages[1]
      : loadingProgress < 90
      ? loadingMessages[2]
      : loadingMessages[3];
  const [hasSeenOnboarding, setHasSeenOnboarding] = useState(() => {
    return false;
  });
  const [selectedExercise, setSelectedExercise] = useState('Agachamento');
  const [historyExercise, setHistoryExercise] = useState('');
  const [progressExercise, setProgressExercise] = useState('');
  const [userProfile, setUserProfile] = useState(() => {
    const saved = localStorage.getItem('moveup_profile');

    if (!saved) {
      return {
        name: '',
        age: '',
        goal: '',
      };
    }

    try {
      return JSON.parse(saved);
    } catch {
      return {
        name: '',
        age: '',
        goal: '',
      };
    }
  });
  const [profileStep, setProfileStep] = useState(0);
  const [cameraFacing, setCameraFacing] = useState<CameraFacing>('environment');

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [status, setStatus] = useState('Carregando IA...');
  const [kneeAngle, setKneeAngle] = useState<number | null>(null);
  const [torsoAngle, setTorsoAngle] = useState<number | null>(null);
  const [hipMetric, setHipMetric] = useState<number | null>(null);
  const [speedSeconds, setSpeedSeconds] = useState<number | null>(null);

  const [stage, setStage] = useState<Stage>('Aguardando corpo');
  const [reps, setReps] = useState(0);
  const [score, setScore] = useState(0);
  const [feedback, setFeedback] = useState(
    'Posicione o corpo inteiro na câmera.'
  );
  const [sessionFinished, setSessionFinished] = useState(false);
  const [repHistory, setRepHistory] = useState<RepData[]>([]);
  const [sessionHistory, setSessionHistory] = useState<SessionData[]>(() => {
    const saved = localStorage.getItem('moveup_history');

    if (!saved) return [];

    try {
      return JSON.parse(saved);
    } catch {
      return [];
    }
  });
  const [calibrationProgress, setCalibrationProgress] = useState(0);
  const [calibrated, setCalibrated] = useState(false);

  const phaseRef = useRef<Phase>('waiting');
  const lowestAngleRef = useRef(180);
  const lastRepTimeRef = useRef(0);
  const descentStartTimeRef = useRef(0);
  const sessionFinishedRef = useRef(false);
  const angleBufferRef = useRef<number[]>([]);
  const standingFramesRef = useRef(0);
  const bottomFramesRef = useRef(0);
  const returnStandingFramesRef = useRef(0);

  const calibrationFramesRef = useRef<number[]>([]);
  const calibratedRef = useRef(false);
  const baselineStandingAngleRef = useRef(170);
  const worstTorsoRef = useRef(0);
  const worstHipRef = useRef(0);

  useEffect(() => {
    if (screen !== 'splash') return;

    setLoadingProgress(0);
    setShowEnterButton(false);

    const interval = setInterval(() => {
      setLoadingProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          setShowEnterButton(true);
          return 100;
        }

        return prev + 2;
      });
    }, 100);

    return () => clearInterval(interval);
  }, [screen]);

  useEffect(() => {
    ['/onboarding-1.png', '/onboarding-2.png', '/onboarding-3.png'].forEach(
      (src) => {
        const img = new Image();
        img.src = src;
      }
    );
  }, []);

  useEffect(() => {
    sessionFinishedRef.current = sessionFinished;
  }, [sessionFinished]);

  useEffect(() => {
    calibratedRef.current = calibrated;
  }, [calibrated]);

  useEffect(() => {
    localStorage.setItem('moveup_history', JSON.stringify(sessionHistory));
  }, [sessionHistory]);

  useEffect(() => {
    localStorage.setItem('moveup_profile', JSON.stringify(userProfile));
  }, [userProfile]);

  useEffect(() => {
    if (screen !== 'squat') return;

    let poseLandmarker: any = null;
    let animationFrameId: number;

    async function start() {
      try {
        setStatus('Pedindo acesso à câmera...');

        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: cameraFacing,
          },
          audio: false,
        });

        if (!videoRef.current) return;

        videoRef.current.srcObject = stream;
        await videoRef.current.play();

        setStatus('Carregando modelo corporal...');

        const fileset = await vision.FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
        );

        poseLandmarker = await vision.PoseLandmarker.createFromOptions(
          fileset,
          {
            baseOptions: {
              modelAssetPath:
                'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task',
              delegate: 'CPU',
            },
            runningMode: 'VIDEO',
            numPoses: 1,
          }
        );

        setStatus(
          cameraFacing === 'environment'
            ? 'IA ativa 🔥 câmera traseira'
            : 'IA ativa 🔥 câmera frontal'
        );

        detectPose();
      } catch (error: any) {
        setStatus(`Erro: ${error?.message || 'falha ao iniciar câmera ou IA'}`);
      }
    }

    function detectPose() {
      const video = videoRef.current;
      const canvas = canvasRef.current;

      if (!video || !canvas || !poseLandmarker) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      if (video.videoWidth === 0 || video.videoHeight === 0) {
        animationFrameId = requestAnimationFrame(detectPose);
        return;
      }

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      const results = poseLandmarker.detectForVideo(video, performance.now());

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const drawingUtils = new vision.DrawingUtils(ctx);

      if (results.landmarks && results.landmarks.length > 0) {
        const landmarks = results.landmarks[0];

        drawingUtils.drawConnectors(
          landmarks,
          vision.PoseLandmarker.POSE_CONNECTIONS,
          { color: '#3B82F6', lineWidth: 4 }
        );

        drawingUtils.drawLandmarks(landmarks, {
          color: '#FFFFFF',
          lineWidth: 2,
          radius: 4,
        });

        const side = getBestSide(landmarks);

        if (!side) {
          resetMotionRefs();
          resetCalibration();

          setStage('Aguardando corpo');
          setFeedback(
            'Fique totalmente de lado, em pé e parado para calibrar.'
          );

          setKneeAngle(null);
          setTorsoAngle(null);
          setHipMetric(null);
          setScore(0);

          animationFrameId = requestAnimationFrame(detectPose);
          return;
        }

        const rawKneeAngle = Math.round(
          calculateAngle(side.hip, side.knee, side.ankle)
        );

        const avgKneeAngle = smoothAngle(rawKneeAngle);

        const avgTorsoAngle = Math.round(
          calculateTorsoAngle(side.shoulder, side.hip)
        );

        const hipValue = Math.round(
          calculateHipShift(side.hip, side.knee, side.ankle) * 100
        );

        setKneeAngle(avgKneeAngle);
        setTorsoAngle(avgTorsoAngle);
        setHipMetric(hipValue);

        const currentScoreParts = calculateScoreParts(
          avgKneeAngle,
          avgTorsoAngle,
          hipValue,
          null
        );

        setScore(currentScoreParts.total);

        if (!calibratedRef.current) {
          runCalibration(avgKneeAngle);
          animationFrameId = requestAnimationFrame(detectPose);
          return;
        }

        if (!sessionFinishedRef.current) {
          updateRepState(avgKneeAngle, avgTorsoAngle, hipValue);
        }
      }

      animationFrameId = requestAnimationFrame(detectPose);
    }

    start();

    return () => {
      cancelAnimationFrame(animationFrameId);

      if (videoRef.current?.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach((track) => track.stop());
      }

      if (poseLandmarker) {
        poseLandmarker.close();
      }
    };
  }, [screen, cameraFacing]);

  function switchCamera() {
    setCameraFacing((prev) => (prev === 'user' ? 'environment' : 'user'));

    setKneeAngle(null);
    setTorsoAngle(null);
    setHipMetric(null);
    setScore(0);
    setSpeedSeconds(null);
    setFeedback('Trocando câmera...');
    resetMotionRefs();
    resetCalibration();
  }

  function getBestSide(landmarks: any[]) {
    const right = {
      shoulder: landmarks[12],
      hip: landmarks[24],
      knee: landmarks[26],
      ankle: landmarks[28],
    };

    const left = {
      shoulder: landmarks[11],
      hip: landmarks[23],
      knee: landmarks[25],
      ankle: landmarks[27],
    };

    const rightVisibility = averageVisibility([
      right.shoulder,
      right.hip,
      right.knee,
      right.ankle,
    ]);

    const leftVisibility = averageVisibility([
      left.shoulder,
      left.hip,
      left.knee,
      left.ankle,
    ]);

    if (rightVisibility < 0.35 && leftVisibility < 0.35) return null;

    return rightVisibility >= leftVisibility ? right : left;
  }

  function averageVisibility(points: any[]) {
    const valid = points.filter(
      (point) => point && point.visibility !== undefined
    );

    if (valid.length === 0) return 0;

    return (
      valid.reduce((acc, point) => acc + point.visibility, 0) / valid.length
    );
  }

  function runCalibration(angle: number) {
    setStage('Calibrando');

    if (angle < 155) {
      calibrationFramesRef.current = [];
      setCalibrationProgress(0);
      setFeedback('Fique em pé e parado de lado para calibrar a IA.');
      return;
    }

    calibrationFramesRef.current.push(angle);

    if (calibrationFramesRef.current.length > 45) {
      calibrationFramesRef.current.shift();
    }

    const progress = Math.round(
      (calibrationFramesRef.current.length / 45) * 100
    );
    setCalibrationProgress(progress);
    setFeedback(`Calibrando IA... fique parado em pé (${progress}%).`);

    if (calibrationFramesRef.current.length >= 45) {
      const avg =
        calibrationFramesRef.current.reduce((acc, value) => acc + value, 0) /
        calibrationFramesRef.current.length;

      baselineStandingAngleRef.current = Math.round(avg);
      calibratedRef.current = true;
      setCalibrated(true);
      setCalibrationProgress(100);
      setStage('Em pé');
      setFeedback('Calibração concluída! Agora comece o agachamento.');
    }
  }

  function updateRepState(angle: number, torso: number, hip: number) {
    const now = Date.now();

    const standingThreshold = Math.max(
      160,
      baselineStandingAngleRef.current - 8
    );
    const startDescentThreshold = baselineStandingAngleRef.current - 25;

    if (angle > standingThreshold) standingFramesRef.current += 1;
    else standingFramesRef.current = 0;

    if (phaseRef.current === 'waiting') {
      setStage('Aguardando corpo');
      setFeedback('Fique em pé de lado e enquadre o corpo inteiro.');

      if (standingFramesRef.current >= 12) {
        phaseRef.current = 'standing';
        setStage('Em pé');
        setFeedback('Boa posição inicial. Agora desça com controle.');
      }

      return;
    }

    if (phaseRef.current === 'standing') {
      setStage('Em pé');
      setFeedback('Boa posição inicial. Agora desça com controle.');

      if (angle < startDescentThreshold) {
        phaseRef.current = 'descending';
        lowestAngleRef.current = angle;
        worstTorsoRef.current = torso;
        worstHipRef.current = hip;
        descentStartTimeRef.current = now;
      }

      return;
    }

    if (phaseRef.current === 'descending') {
      setStage('Descendo');
      setFeedback('Continue descendo com controle.');

      if (angle < lowestAngleRef.current) {
        lowestAngleRef.current = angle;
        worstTorsoRef.current = torso;
        worstHipRef.current = hip;
      }

      if (angle <= 115) bottomFramesRef.current += 1;
      else bottomFramesRef.current = 0;

      if (bottomFramesRef.current >= 5) phaseRef.current = 'bottom';

      if (angle > standingThreshold) {
        resetMotionRefs();
        phaseRef.current = 'standing';
      }

      return;
    }

    if (phaseRef.current === 'bottom') {
      setStage('Agachado');

      if (angle < lowestAngleRef.current) {
        lowestAngleRef.current = angle;
        worstTorsoRef.current = torso;
        worstHipRef.current = hip;
      }

      if (hip < 40) {
        setFeedback('Quadril foi muito para trás. Tente manter mais controle.');
      } else if (torso > 28) {
        setFeedback('Tente manter o peito mais aberto.');
      } else {
        setFeedback('Boa profundidade! Agora suba.');
      }

      if (angle > 125) phaseRef.current = 'ascending';

      return;
    }

    if (phaseRef.current === 'ascending') {
      setStage('Subindo');
      setFeedback('Suba mantendo controle.');

      if (angle > standingThreshold) returnStandingFramesRef.current += 1;
      else returnStandingFramesRef.current = 0;

      if (
        returnStandingFramesRef.current >= 8 &&
        lowestAngleRef.current <= 115 &&
        now - lastRepTimeRef.current > 1800
      ) {
        const finalDepth = lowestAngleRef.current;
        const durationSeconds = (now - descentStartTimeRef.current) / 1000;

        const finalTorso = worstTorsoRef.current;
        const finalHip = worstHipRef.current;

        const repScoreParts = calculateScoreParts(
          finalDepth,
          finalTorso,
          finalHip,
          durationSeconds
        );

        setSpeedSeconds(Number(durationSeconds.toFixed(1)));

        setReps((prev) => prev + 1);

        setRepHistory((prev) => [
          ...prev,
          {
            depth: finalDepth,
            torso: finalTorso,
            hip: finalHip,
            speed: Number(durationSeconds.toFixed(1)),
            score: repScoreParts.total,
            depthScore: repScoreParts.depthScore,
            torsoScore: repScoreParts.torsoScore,
            hipScore: repScoreParts.hipScore,
            speedScore: repScoreParts.speedScore,
          },
        ]);

        lastRepTimeRef.current = now;
        resetMotionRefs();
        phaseRef.current = 'standing';
        setStage('Em pé');
        setFeedback('Boa repetição!');
      }
    }
  }

  function calculateHipShift(hip: any, knee: any, ankle: any) {
    const bodyScale = Math.abs(hip.y - ankle.y) || 0.1;

    const hipBehindKnee = Math.abs(hip.x - knee.x);
    const hipBehindAnkle = Math.abs(hip.x - ankle.x);

    return Math.max(hipBehindKnee, hipBehindAnkle) / bodyScale;
  }

  function calculateScoreParts(
    knee: number,
    torso: number,
    hip: number,
    durationSeconds: number | null
  ) {
    let depthScore = 0;
    let torsoScore = 0;
    let hipScore = 0;
    let speedScore = 0;

    if (knee <= 85) depthScore = 40;
    else if (knee <= 95) depthScore = 34;
    else if (knee <= 105) depthScore = 24;
    else if (knee <= 115) depthScore = 12;
    else if (knee <= 130) depthScore = 4;
    else depthScore = 0;

    if (torso <= 12) torsoScore = 25;
    else if (torso <= 17) torsoScore = 20;
    else if (torso <= 22) torsoScore = 13;
    else if (torso <= 30) torsoScore = 6;
    else torsoScore = 2;

    if (hip >= 100) hipScore = 20;
    else if (hip >= 80) hipScore = 15;
    else if (hip >= 60) hipScore = 9;
    else if (hip >= 40) hipScore = 4;
    else hipScore = 0;

    if (durationSeconds === null) {
      speedScore = 15;
    } else if (durationSeconds >= 2.2 && durationSeconds <= 5.0) {
      speedScore = 15;
    } else if (durationSeconds >= 1.6 && durationSeconds < 2.2) {
      speedScore = 10;
    } else if (durationSeconds > 5.0 && durationSeconds <= 7.0) {
      speedScore = 10;
    } else if (durationSeconds >= 1.1 && durationSeconds < 1.6) {
      speedScore = 5;
    } else {
      speedScore = 2;
    }

    return {
      depthScore,
      torsoScore,
      hipScore,
      speedScore,
      total: depthScore + torsoScore + hipScore + speedScore,
    };
  }

  function resetCalibration() {
    calibrationFramesRef.current = [];
    calibratedRef.current = false;
    setCalibrated(false);
    setCalibrationProgress(0);
  }

  function resetMotionRefs() {
    phaseRef.current = 'waiting';
    lowestAngleRef.current = 180;
    standingFramesRef.current = 0;
    bottomFramesRef.current = 0;
    returnStandingFramesRef.current = 0;
    angleBufferRef.current = [];
    descentStartTimeRef.current = 0;
    worstTorsoRef.current = 0;
    worstHipRef.current = 0;
  }

  function smoothAngle(angle: number) {
    angleBufferRef.current.push(angle);

    if (angleBufferRef.current.length > 8) {
      angleBufferRef.current.shift();
    }

    const sum = angleBufferRef.current.reduce((acc, value) => acc + value, 0);
    return Math.round(sum / angleBufferRef.current.length);
  }

  function calculateAngle(a: any, b: any, c: any) {
    const radians =
      Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);

    let angle = Math.abs((radians * 180) / Math.PI);
    if (angle > 180) angle = 360 - angle;

    return angle;
  }

  function calculateTorsoAngle(shoulder: any, hip: any) {
    const dx = shoulder.x - hip.x;
    const dy = shoulder.y - hip.y;

    const radians = Math.atan2(dx, Math.abs(dy));
    return Math.abs((radians * 180) / Math.PI);
  }

  const averageScore =
    repHistory.length > 0
      ? Math.round(
          repHistory.reduce((acc, rep) => acc + rep.score, 0) /
            repHistory.length
        )
      : 0;

  const averageDepth =
    repHistory.length > 0
      ? Math.round(
          repHistory.reduce((acc, rep) => acc + rep.depth, 0) /
            repHistory.length
        )
      : 0;

  const averageDepthScore =
    repHistory.length > 0
      ? Math.round(
          repHistory.reduce((acc, rep) => acc + rep.depthScore, 0) /
            repHistory.length
        )
      : 0;

  const averageTorsoScore =
    repHistory.length > 0
      ? Math.round(
          repHistory.reduce((acc, rep) => acc + rep.torsoScore, 0) /
            repHistory.length
        )
      : 0;

  const averageHipScore =
    repHistory.length > 0
      ? Math.round(
          repHistory.reduce((acc, rep) => acc + rep.hipScore, 0) /
            repHistory.length
        )
      : 0;

  const averageSpeedScore =
    repHistory.length > 0
      ? Math.round(
          repHistory.reduce((acc, rep) => acc + rep.speedScore, 0) /
            repHistory.length
        )
      : 0;

  const isProfileComplete =
    (userProfile.name || '').trim() !== '' &&
    (userProfile.age || '').trim() !== '' &&
    (userProfile.goal || '').trim() !== '';

  const completedSessions = sessionHistory.length;

  const totalRepsLevel =
    sessionHistory.length > 0
      ? sessionHistory.reduce((acc, item) => acc + item.reps, 0)
      : 0;

  const weightedAverageScore =
    totalRepsLevel > 0
      ? Math.round(
          sessionHistory.reduce(
            (acc, item) => acc + item.averageScore * item.reps,
            0
          ) / totalRepsLevel
        )
      : 0;

  const userLevel =
    completedSessions >= 100 && weightedAverageScore >= 90
      ? '💎 Elite'
      : completedSessions >= 60 && weightedAverageScore >= 85
      ? '🥇 Ouro'
      : completedSessions >= 30 && weightedAverageScore >= 80
      ? '🥈 Prata'
      : completedSessions >= 10 && weightedAverageScore >= 75
      ? '🥉 Bronze'
      : '🔰 Iniciante';

  function getImprovementMessage() {
    if (repHistory.length === 0) {
      return 'Finalize uma série para receber uma análise da sua execução.';
    }

    if (averageScore >= 90) {
      return 'Parabéns! Sua execução foi muito consistente. Você manteve boa profundidade, alinhamento e controle durante toda a série.';
    }

    const scores = [
      {
        name: 'depth',
        value: averageDepthScore,
      },
      {
        name: 'torso',
        value: averageTorsoScore,
      },
      {
        name: 'hip',
        value: averageHipScore,
      },
      {
        name: 'speed',
        value: averageSpeedScore,
      },
    ];

    const worst = scores.reduce((prev, current) =>
      current.value < prev.value ? current : prev
    );

    if (worst.name === 'depth') {
      return 'Você não atingiu a profundidade ideal em parte das repetições. Tente descer um pouco mais mantendo o controle do movimento.';
    }

    if (worst.name === 'torso') {
      return 'Durante algumas repetições o tronco inclinou mais do que o recomendado. Tente manter o peito aberto e olhar para frente durante a descida.';
    }

    if (worst.name === 'hip') {
      return 'O quadril se deslocou excessivamente para trás durante a execução. Procure manter o movimento mais equilibrado entre quadril e joelhos.';
    }

    return 'A velocidade do movimento variou ao longo da série. Tente manter uma descida e subida mais controladas e consistentes.';
  }

  const improvementMessage = getImprovementMessage();

  function startExercise() {
    if (selectedExercise !== 'Agachamento') {
      alert('Esse exercício ainda está em desenvolvimento 🚧');
      return;
    }

    setScreen('squat');
    setReps(0);
    setRepHistory([]);
    setSessionFinished(false);
    setFeedback('Posicione o corpo inteiro na câmera.');
    setScore(0);
    setSpeedSeconds(null);
    resetMotionRefs();
    resetCalibration();
  }

  function saveCurrentSession() {
    if (reps <= 0) {
      setFeedback('Finalize apenas depois de pelo menos 1 repetição válida.');
      return false;
    }

    const newSession: SessionData = {
      exercise: selectedExercise,
      reps,
      averageScore: averageScore || score,
      averageDepth,
      date: new Date().toLocaleString('pt-BR'),
    };

    setSessionHistory((prev) => [newSession, ...prev]);
    return true;
  }

  function finishSession() {
    setSessionFinished(true);
    saveCurrentSession();
  }

  function goHome() {
    if (reps > 0 && !sessionFinished) {
      saveCurrentSession();
    }

    setScreen('home');
    resetMotionRefs();
    resetCalibration();
  }

  if (screen === 'splash') {
    return (
      <div style={splashPageStyle}>
        <div style={splashGlowStyle} />

        <div style={splashLogoCircleStyle}>
          <img
            src="/logo-symbol.png"
            alt="MoveUp"
            style={{
              width: 400,
              height: 400,
              borderRadius: 28,
              transform: 'translateY(12px) translateX(-4px)',
              objectFit: 'contain',
            }}
          />
        </div>

        <h1 style={splashTitleStyle}>
          <span style={{ color: 'white' }}>Move</span>
          <span style={{ color: '#3B82F6' }}>Up</span>
        </h1>

        <p style={splashSubtitleStyle}>IA que te move</p>

        <div style={splashFeatureRowStyle}>
          <span>🤖 Análise por IA</span>
          <span>📈 Evolução real</span>
        </div>

        <div style={splashLoadingTrackStyle}>
          <div
            style={{
              ...splashLoadingBarStyle,
              width: `${loadingProgress}%`,
              transition: 'width 0.1s linear',
            }}
          />
        </div>

        {!showEnterButton && (
          <p style={splashLoadingTextStyle}>{loadingMessage}</p>
        )}
        {showEnterButton && (
          <button
            onClick={() => {
              if (!hasSeenOnboarding) {
                setScreen('onboarding');
                return;
              }

              setScreen(isProfileComplete ? 'home' : 'profileSetup');
            }}
            style={{
              marginTop: 26,
              width: 220,
              height: 56,
              borderRadius: 18,
              border: 'none',
              background: '#2563EB',
              color: 'white',
              fontSize: 18,
              fontWeight: 700,
              boxShadow: '0 0 24px rgba(37,99,235,0.45)',
              animation: 'fadeIn 0.4s ease',
            }}
          >
            Entrar
          </button>
        )}
        <style>
          {`
    @keyframes pulseGlow {
      0% {
        transform: scale(1);
        box-shadow: 0 0 28px rgba(37,99,235,0.25);
      }

      50% {
        transform: scale(1.04);
        box-shadow: 0 0 55px rgba(37,99,235,0.55);
      }

      100% {
        transform: scale(1);
        box-shadow: 0 0 28px rgba(37,99,235,0.25);
      }
    }

    @keyframes fadeIn {
      from {
        opacity: 0;
        transform: translateY(8px);
      }

      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
  `}
        </style>
      </div>
    );
  }

  if (screen === 'home') {
    return (
      <AppLayout active="home" setScreen={setScreen}>
        <div style={{ marginBottom: 28 }}>
          <div
            style={{
              color: '#60A5FA',
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: 1.5,
              textTransform: 'uppercase',
              marginBottom: 10,
            }}
          >
            Olá, {(userProfile.name || 'atleta').split(' ')[0]} 👋
          </div>

          <h1
            style={{
              margin: 0,
              fontSize: 38,
              lineHeight: 1,
              fontWeight: 900,
              letterSpacing: -1.5,
            }}
          >
            <span style={{ color: 'white' }}>Move</span>
            <span style={{ color: '#3B82F6' }}>Up</span>
          </h1>

          <p
            style={{
              color: '#94A3B8',
              marginTop: 14,
              fontSize: 16,
              lineHeight: 1.5,
              maxWidth: 320,
              textAlign: 'center',
              margin: '60px auto 0',
            }}
          >
            Pronto para seu treino de hoje? Escolha um exercício e receba
            análise biomecânica por IA.
          </p>
        </div>

        <div style={{ marginTop: 28 }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 12,
              marginTop: 24,
            }}
          >
            <ExerciseCard
              name="Agachamento"
              emoji="🏋️"
              active={selectedExercise === 'Agachamento'}
              available
              onClick={() => setSelectedExercise('Agachamento')}
            />
            <ExerciseCard
              name="Flexão"
              emoji="💪"
              active={selectedExercise === 'Flexão'}
              available={false}
              onClick={() => setSelectedExercise('Flexão')}
            />
            <ExerciseCard
              name="Prancha"
              emoji="🧘"
              active={selectedExercise === 'Prancha'}
              available={false}
              onClick={() => setSelectedExercise('Prancha')}
            />
            <ExerciseCard
              name="Corrida"
              emoji="🏃"
              active={selectedExercise === 'Corrida'}
              available={false}
              onClick={() => setSelectedExercise('Corrida')}
            />
          </div>
        </div>

        <button onClick={startExercise} style={primaryButtonStyle}>
          Iniciar {selectedExercise}
        </button>
      </AppLayout>
    );
  }

  if (screen === 'history') {
    const filteredHistory = sessionHistory.filter((item) => {
      const itemExercise = item.exercise || 'Agachamento';
      return itemExercise === historyExercise;
    });
    return (
      <AppLayout active="history" setScreen={setScreen}>
        <div
          style={{
            width: 78,
            height: 78,
            borderRadius: 28,
            background: 'linear-gradient(145deg, #2563EB, #0F172A)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 20px',
            boxShadow: '0 0 30px rgba(37,99,235,0.35)',
          }}
        >
          <div
            style={{
              transform: 'scale(1.8)',
              color: 'white',
              marginTop: 12,
            }}
          >
            <HistoryIcon />
          </div>
        </div>

        <h1
          style={{
            margin: '0 0 24px 0',
            color: 'white',
            fontSize: 42,
            fontWeight: 900,
            textAlign: 'center',
          }}
        >
          Histórico
        </h1>

        <select
          value={historyExercise}
          onChange={(e) => setHistoryExercise(e.target.value)}
          style={{
            width: '100%',
            padding: 12,
            borderRadius: 12,
            background: '#0F172A',
            color: 'white',
            border: '1px solid #1E293B',
          }}
        >
          <option value="">Selecione o exercício</option>

          <option value="Agachamento">Agachamento</option>

          <option value="Flexão">Flexão</option>

          <option value="Prancha">Prancha</option>

          <option value="Corrida">Corrida</option>
        </select>

        {historyExercise === '' ? (
          <p style={{ color: '#A1A1AA' }}>
            Selecione um exercício para ver o histórico.
          </p>
        ) : filteredHistory.length === 0 ? (
          <p style={{ color: '#A1A1AA' }}>
            Nenhuma série salva para este exercício.
          </p>
        ) : (
          filteredHistory.map((item, index) => {
            const performanceLabel =
              item.averageScore >= 90
                ? 'Excelente execução'
                : item.averageScore >= 75
                ? 'Boa execução'
                : item.averageScore >= 60
                ? 'Atenção à técnica'
                : 'Precisa melhorar';

            return (
              <div key={index} style={listCardStyle}>
                <strong>{item.date}</strong>

                <p>Repetições: {item.reps}</p>
                <p>Nota: {item.averageScore}</p>

                <div
                  style={{
                    marginTop: 10,
                    padding: '8px 10px',
                    borderRadius: 12,
                    background: 'rgba(37,99,235,0.12)',
                    color: '#60A5FA',
                    fontWeight: 'bold',
                    fontSize: 13,
                  }}
                >
                  {performanceLabel}
                </div>
              </div>
            );
          })
        )}
      </AppLayout>
    );
  }

  if (screen === 'progress') {
    const filteredProgress = sessionHistory.filter((item) => {
      const itemExercise = item.exercise || 'Agachamento';
      return itemExercise === progressExercise;
    });

    const chartData = filteredProgress
      .slice()
      .reverse()
      .map((item, index) => ({
        treino: index + 1,
        score: item.averageScore,
        profundidade: item.averageDepth,
      }));

    const totalSessions = filteredProgress.length;

    const totalReps =
      filteredProgress.length > 0
        ? filteredProgress.reduce((acc, item) => acc + item.reps, 0)
        : 0;

    const bestScore =
      filteredProgress.length > 0
        ? Math.max(...filteredProgress.map((item) => item.averageScore))
        : 0;

    const overallAverage =
      filteredProgress.length > 0
        ? Math.round(
            filteredProgress.reduce((acc, item) => acc + item.averageScore, 0) /
              filteredProgress.length
          )
        : 0;

    return (
      <AppLayout active="progress" setScreen={setScreen}>
        <div
          style={{
            width: 78,
            height: 78,
            borderRadius: 28,
            background: 'linear-gradient(145deg, #2563EB, #0F172A)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 20px',
            boxShadow: '0 0 30px rgba(37,99,235,0.35)',
          }}
        >
          <div
            style={{
              transform: 'scale(1.8)',
              color: 'white',
              marginTop: 8,
            }}
          >
            <ChartIcon />
          </div>
        </div>

        <h1
          style={{
            margin: '0 0 24px 0',
            color: 'white',
            fontSize: 42,
            fontWeight: 900,
            textAlign: 'center',
          }}
        >
          Evolução
        </h1>

        <p
          style={{
            color: '#94A3B8',
            marginTop: 10,
            marginBottom: 18,
            textAlign: 'center',
          }}
        >
          Acompanhe sua evolução treino após treino.
        </p>

        <select
          value={progressExercise}
          onChange={(e) => setProgressExercise(e.target.value)}
          style={{
            width: '100%',
            padding: 12,
            borderRadius: 12,
            background: '#0F172A',
            color: 'white',
            border: '1px solid #1E293B',
            marginBottom: 18,
          }}
        >
          <option value="">Selecione o exercício</option>
          <option value="Agachamento">Agachamento</option>
          <option value="Flexão">Flexão</option>
          <option value="Prancha">Prancha</option>
          <option value="Corrida">Corrida</option>
        </select>

        <div style={statsGridStyle}>
          <MetricCard title="Séries" value={`${totalSessions}`} />
          <MetricCard title="Média" value={`${overallAverage}`} />
          <MetricCard title="Melhor" value={`${bestScore}`} />
          <MetricCard title="Reps" value={`${totalReps}`} />
        </div>

        <div style={chartCardStyle}>
          <div style={{ fontWeight: 'bold', marginBottom: 12 }}>
            Score por treino
          </div>

          {progressExercise === '' ? (
            <p style={{ color: '#A1A1AA' }}>
              Selecione um exercício para ver sua evolução.
            </p>
          ) : chartData.length === 0 ? (
            <p style={{ color: '#A1A1AA' }}>
              Nenhuma série salva para este exercício.
            </p>
          ) : (
            <div style={{ width: '100%', height: 240 }}>
              <ResponsiveContainer>
                <LineChart data={chartData}>
                  <XAxis dataKey="treino" stroke="#94A3B8" />
                  <YAxis domain={[0, 100]} stroke="#94A3B8" />
                  <Tooltip />

                  <Line
                    type="monotone"
                    dataKey="score"
                    stroke="#3B82F6"
                    strokeWidth={3}
                    dot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </AppLayout>
    );
  }

  if (screen === 'onboarding') {
    const onboardingScreens = [
      {
        step: '1 / 3',
        title1: 'Grave seu',
        title2: 'treino',
        description: 'Envie seu agachamento em segundos.',
        image: '/onboarding-1.png',
      },
      {
        step: '2 / 3',
        title1: 'Receba análise',
        title2: 'por IA',
        description: 'Descubra pontos para melhorar sua execução.',
        image: '/onboarding-2.png',
      },
      {
        step: '3 / 3',
        title1: 'Acompanhe sua',
        title2: 'evolução',
        description: 'Veja sua melhora treino após treino.',
        image: '/onboarding-3.png',
      },
    ];

    const current = onboardingScreens[introStep];

    return (
      <div style={premiumPageStyle}>
        <div style={premiumTopRowStyle}>
          <div style={premiumBrandStyle}>
            Move<span style={{ color: '#3B82F6' }}>Up</span>
          </div>

          <button
            onClick={() =>
              setScreen(isProfileComplete ? 'home' : 'profileSetup')
            }
            style={premiumSkipStyle}
          >
            Skip
          </button>
        </div>

        <div style={onboardingMockupCardStyle}>
          <div style={onboardingStepStyle}>{current.step}</div>

          <h1 style={onboardingMockupTitleStyle}>
            {current.title1}
            <br />
            <span style={{ color: '#3B82F6' }}>{current.title2}</span>
          </h1>

          <p style={onboardingMockupDescriptionStyle}>{current.description}</p>

          <div
            style={
              introStep === 1 || introStep === 2
                ? {
                    flex: 1,
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    marginTop: 18,
                    marginBottom: 8,
                  }
                : onboardingImageFrameStyle
            }
          >
            <img
              key={current.image}
              src={current.image}
              alt="onboarding"
              style={{
                ...onboardingMockupImageStyle,

                width:
                  introStep === 1 ? '50%' : introStep === 2 ? '50%' : '80%',

                marginTop: introStep === 1 ? 40 : 0,

                transform:
                  introStep === 2
                    ? 'scale(2.35)'
                    : introStep === 1
                    ? 'scale(2.35)'
                    : 'none',

                objectFit: 'contain',
                pointerEvents: 'none',
              }}
            />
          </div>

          <div style={premiumDotsRowStyle}>
            {onboardingScreens.map((_, index) => (
              <div
                key={index}
                style={{
                  ...premiumDotStyle,
                  background: introStep === index ? '#3B82F6' : '#334155',
                }}
              />
            ))}
          </div>

          <button
            onClick={() => {
              if (introStep < onboardingScreens.length - 1) {
                setIntroStep((prev) => prev + 1);
                return;
              }

              localStorage.setItem('moveup_onboarding_seen', 'true');
              setHasSeenOnboarding(true);
              setScreen(isProfileComplete ? 'home' : 'profileSetup');
            }}
            style={onboardingMockupButtonStyle}
          >
            {introStep === onboardingScreens.length - 1 ? 'Começar' : 'Próximo'}
          </button>
        </div>
      </div>
    );
  }

  if (screen === 'profileSetup') {
    const goals = [
      'Melhorar execução',
      'Ganhar força',
      'Ganhar massa muscular',
      'Emagrecer',
      'Condicionamento físico',
    ];

    return (
      <div style={mobilePageStyle}>
        <div style={appShellStyle}>
          <div style={appContentStyle}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                marginBottom: 12,
                color: '#60A5FA',
                transform: 'scale(2)',
              }}
            >
              <UserIcon />
            </div>

            <h1
              style={{
                margin: 0,
                color: 'white',
                fontSize: 42,
                fontWeight: 900,
                textAlign: 'center',
              }}
            >
              Perfil
            </h1>

            <p
              style={{
                color: '#94A3B8',
                textAlign: 'center',
                marginTop: 10,
                marginBottom: 24,
              }}
            >
              Vamos configurar seu perfil rapidamente.
            </p>

            <div style={listCardStyle}>
              {profileStep === 0 && (
                <>
                  <h2
                    style={{
                      marginTop: 0,
                      color: 'white',
                      textAlign: 'center',
                      fontSize: 28,
                      fontWeight: 800,
                    }}
                  >
                    Como podemos te chamar?
                  </h2>

                  <p
                    style={{
                      color: '#A1A1AA',
                      lineHeight: 1.5,
                      textAlign: 'center',
                    }}
                  >
                    Digite seu nome para personalizar sua experiência.
                  </p>

                  <input
                    value={userProfile.name || ''}
                    placeholder="Digite seu nome"
                    onChange={(e) =>
                      setUserProfile((prev: any) => ({
                        ...prev,
                        name: e.target.value,
                      }))
                    }
                    style={inputStyle}
                  />

                  <button
                    onClick={() => {
                      if ((userProfile.name || '').trim() === '') return;
                      setProfileStep(1);
                    }}
                    style={primaryButtonStyle}
                  >
                    Próximo
                  </button>
                </>
              )}

              {profileStep === 1 && (
                <>
                  <h2 style={{ marginTop: 0 }}>Qual é a sua idade?</h2>

                  <p
                    style={{
                      color: '#A1A1AA',
                      lineHeight: 1.5,
                      textAlign: 'center',
                    }}
                  >
                    Informe sua idade para completar seu perfil.
                  </p>

                  <input
                    value={userProfile.age || ''}
                    placeholder="Digite sua idade"
                    type="number"
                    onChange={(e) =>
                      setUserProfile((prev: any) => ({
                        ...prev,
                        age: e.target.value,
                      }))
                    }
                    style={inputStyle}
                  />

                  <button
                    onClick={() => {
                      if ((userProfile.age || '').trim() === '') return;
                      setProfileStep(2);
                    }}
                    style={primaryButtonStyle}
                  >
                    Próximo
                  </button>
                </>
              )}

              {profileStep === 2 && (
                <>
                  <h2
                    style={{
                      marginTop: 0,
                      color: 'white',
                      textAlign: 'center',
                      fontSize: 28,
                      fontWeight: 800,
                    }}
                  >
                    Qual é o seu objetivo?
                  </h2>

                  <p
                    style={{
                      color: '#A1A1AA',
                      lineHeight: 1.5,
                      textAlign: 'center',
                    }}
                  >
                    Escolha o objetivo que mais combina com você.
                  </p>

                  <div style={{ display: 'grid', gap: 10, marginTop: 14 }}>
                    {goals.map((goal) => (
                      <button
                        key={goal}
                        onClick={() =>
                          setUserProfile((prev: any) => ({
                            ...prev,
                            goal,
                          }))
                        }
                        style={{
                          padding: '14px 12px',
                          borderRadius: 14,
                          border:
                            userProfile.goal === goal
                              ? '1px solid #60A5FA'
                              : '1px solid #1E293B',
                          background:
                            userProfile.goal === goal
                              ? 'rgba(37,99,235,0.22)'
                              : '#020617',
                          color: 'white',
                          fontWeight: 'bold',
                          textAlign: 'left',
                        }}
                      >
                        {goal}
                      </button>
                    ))}
                  </div>

                  <button
                    onClick={() => {
                      if ((userProfile.goal || '').trim() === '') return;
                      setProfileStep(3);
                    }}
                    style={primaryButtonStyle}
                  >
                    Salvar perfil
                  </button>
                </>
              )}

              {profileStep === 3 && (
                <>
                  <h2 style={{ marginTop: 0 }}>Perfil salvo ✅</h2>

                  <p style={{ color: '#A1A1AA', lineHeight: 1.5 }}>
                    Pronto! Suas informações foram salvas e agora o MoveUp pode
                    personalizar melhor sua experiência.
                  </p>

                  <div style={{ marginTop: 16 }}>
                    <p>
                      <strong>Nome:</strong> {userProfile.name}
                    </p>
                    <p>
                      <strong>Idade:</strong> {userProfile.age}
                    </p>
                    <p>
                      <strong>Objetivo:</strong> {userProfile.goal}
                    </p>
                  </div>

                  <button
                    onClick={() => {
                      setProfileStep(0);
                      setScreen('home');
                    }}
                    style={primaryButtonStyle}
                  >
                    Ir para o treino
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (screen === 'profile') {
    return (
      <AppLayout active="profile" setScreen={setScreen}>
        <div style={{ textAlign: 'center', marginBottom: 22 }}>
          <div
            style={{
              width: 78,
              height: 78,
              borderRadius: 28,
              background: 'linear-gradient(145deg, #2563EB, #0F172A)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 34,
              margin: '0 auto 14px',
              boxShadow: '0 0 30px rgba(37,99,235,0.35)',
            }}
          >
            <div
              style={{
                transform: 'scale(1.8)',
                color: 'white',
              }}
            >
              <UserIcon />
            </div>
          </div>

          <h1
            style={{
              margin: 0,
              color: 'white',
            }}
          >
            Perfil
          </h1>

          <p style={{ color: '#94A3B8', marginTop: 8 }}>Seu espaço no MoveUp</p>
        </div>

        <div
          style={{
            background:
              'linear-gradient(145deg, rgba(37,99,235,0.16), #0F172A)',
            border: '1px solid rgba(96,165,250,0.22)',
            borderRadius: 28,
            padding: 20,
            boxShadow: '0 0 28px rgba(37,99,235,0.12)',
          }}
        >
          <div style={{ marginBottom: 18 }}>
            <p style={{ color: '#94A3B8', margin: '0 0 6px', fontSize: 13 }}>
              Nome
            </p>
            <div style={{ fontSize: 22, fontWeight: 900 }}>
              {userProfile.name || 'Não informado'}
            </div>
          </div>

          <div
            style={{
              height: 1,
              background: 'rgba(148,163,184,0.16)',
              margin: '18px 0',
            }}
          />

          <div
            style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}
          >
            <div>
              <p style={{ color: '#94A3B8', margin: '0 0 6px', fontSize: 13 }}>
                Idade
              </p>
              <div style={{ fontSize: 20, fontWeight: 800 }}>
                {userProfile.age || '--'}
              </div>
            </div>

            <div>
              <p style={{ color: '#94A3B8', margin: '0 0 6px', fontSize: 13 }}>
                Nível
              </p>
              <div style={{ fontSize: 20, fontWeight: 800 }}>{userLevel}</div>
            </div>
          </div>

          <div
            style={{
              marginTop: 12,
              padding: 12,
              borderRadius: 14,
              background: 'rgba(37,99,235,0.08)',
              border: '1px solid rgba(96,165,250,0.18)',
              fontSize: 13,
              lineHeight: 1.5,
              color: '#CBD5E1',
            }}
          >
            ℹ️ Seu nível é atualizado automaticamente pelo MoveUp com base na
            frequência dos treinos e na qualidade da execução.
          </div>

          <div
            style={{
              height: 1,
              background: 'rgba(148,163,184,0.16)',
              margin: '18px 0',
            }}
          />

          <div>
            <p style={{ color: '#94A3B8', margin: '0 0 8px', fontSize: 13 }}>
              Objetivo principal
            </p>

            <div
              style={{
                display: 'inline-flex',
                padding: '10px 14px',
                borderRadius: 999,
                background: 'rgba(37,99,235,0.18)',
                border: '1px solid rgba(96,165,250,0.35)',
                color: '#BFDBFE',
                fontWeight: 800,
              }}
            >
              {userProfile.goal || 'Não informado'}
            </div>
          </div>

          <button
            onClick={() => {
              setProfileStep(0);
              setScreen('profileSetup');
            }}
            style={{
              ...primaryButtonStyle,
              marginTop: 26,
              borderRadius: 18,
              height: 52,
            }}
          >
            Editar perfil
          </button>
        </div>
      </AppLayout>
    );
  }

  return (
    <div style={pageStyle}>
      <div
        style={{
          width: 'min(100vw, 430px)',
          height: '100dvh',
          minHeight: '100vh',
          borderRadius: 0,
          overflow: 'hidden',
          border: 'none',
          background: 'black',
          position: 'relative',
        }}
      >
        <video ref={videoRef} playsInline muted style={{ display: 'none' }} />

        <canvas
          ref={canvasRef}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
          }}
        />

        <button onClick={goHome} style={homeButtonStyle}>
          ← Tela inicial
        </button>

        <button onClick={switchCamera} style={switchCameraButtonStyle}>
          🔄 Câmera
        </button>

        <div
          style={{
            position: 'absolute',
            top: 70,
            left: 18,
            right: 18,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div style={{ fontSize: 22, fontWeight: 'bold' }}>
            Move<span style={{ color: '#3B82F6' }}>Up</span> AI 🔥
          </div>

          <div
            style={{
              background: 'rgba(37,99,235,0.9)',
              padding: '8px 12px',
              borderRadius: 999,
              fontSize: 13,
              fontWeight: 'bold',
            }}
          >
            Reps: {reps}
          </div>
        </div>

        <div
          style={{
            position: 'absolute',
            bottom: 18,
            left: 18,
            right: 18,
            background: 'rgba(17,24,39,0.92)',
            padding: 14,
            borderRadius: 16,
          }}
        >
          <div style={gridStyle}>
            <InfoCard title="Status" value={stage} />
            <InfoCard
              title="Joelho"
              value={kneeAngle ? `${kneeAngle}°` : '--'}
            />
            <InfoCard title="Score" value={`${score}`} />
          </div>

          <div style={gridStyle}>
            <InfoCard
              title="Tronco"
              value={torsoAngle ? `${torsoAngle}°` : '--'}
            />
            <InfoCard
              title="Quadril"
              value={hipMetric !== null ? `${hipMetric}` : '--'}
            />
            <InfoCard
              title="Tempo"
              value={speedSeconds ? `${speedSeconds}s` : '--'}
            />
          </div>

          {!calibrated && (
            <div
              style={{
                height: 8,
                background: '#0F172A',
                borderRadius: 999,
                overflow: 'hidden',
                marginBottom: 10,
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${calibrationProgress}%`,
                  background: '#3B82F6',
                }}
              />
            </div>
          )}

          <div
            style={{
              color: '#60A5FA',
              fontWeight: 'bold',
              fontSize: 14,
              marginBottom: 10,
            }}
          >
            {feedback}
          </div>

          {!sessionFinished ? (
            <button onClick={finishSession} style={primaryButtonStyle}>
              Finalizar Série
            </button>
          ) : (
            <div style={listCardStyle}>
              <div style={{ fontWeight: 'bold', marginBottom: 8 }}>
                🏋️ Resultado Final
              </div>

              <div>Repetições: {reps}</div>
              <div>Nota: {averageScore}</div>

              <div style={{ marginTop: 14 }}>
                <strong>💡 O que melhorar</strong>
              </div>

              <p style={{ color: '#CBD5E1', lineHeight: 1.5, marginBottom: 0 }}>
                {improvementMessage}
              </p>

              <button
                onClick={() => {
                  setReps(0);
                  setRepHistory([]);
                  setSessionFinished(false);
                  setFeedback('Nova série iniciada 🔥');
                  setScore(0);
                  setSpeedSeconds(null);
                  resetMotionRefs();
                  resetCalibration();
                  lastRepTimeRef.current = Date.now();
                }}
                style={{
                  ...primaryButtonStyle,
                  background: '#16A34A',
                  marginTop: 14,
                }}
              >
                Nova Série
              </button>
            </div>
          )}

          <div style={{ color: '#A1A1AA', fontSize: 12, marginTop: 8 }}>
            {status}
          </div>
        </div>
      </div>
    </div>
  );

  function AppLayout({
    children,
    active,
    setScreen,
  }: {
    children: React.ReactNode;
    active: Screen;
    setScreen: (screen: Screen) => void;
  }) {
    return (
      <div style={mobilePageStyle}>
        <div style={appShellStyle}>
          <div style={appContentStyle}>{children}</div>
          <BottomNav active={active} setScreen={setScreen} />
        </div>
      </div>
    );
  }

  function BottomNav({ active, setScreen }: any) {
    return (
      <div style={bottomNavStyle}>
        <NavButton
          icon={<DumbbellIcon />}
          label="Home"
          active={active === 'home'}
          onClick={() => setScreen('home')}
        />
        <NavButton
          icon={<HistoryIcon />}
          label="Histórico"
          active={active === 'history'}
          onClick={() => setScreen('history')}
        />
        <NavButton
          icon={<ChartIcon />}
          label="Evolução"
          active={active === 'progress'}
          onClick={() => setScreen('progress')}
        />
        <NavButton
          icon={<UserIcon />}
          label="Perfil"
          active={active === 'profile'}
          onClick={() => setScreen('profile')}
        />
      </div>
    );
  }

  function NavButton({ icon, label, active, onClick }: any) {
    return (
      <button
        onClick={onClick}
        style={{
          background: 'none',
          border: 'none',
          color: active ? '#60A5FA' : '#A1A1AA',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 4,
          fontSize: 12,
        }}
      >
        <span>{icon}</span>
        {label}
      </button>
    );
  }

  function ExerciseCard({ name, emoji, active, available, onClick }: any) {
    return (
      <button
        onClick={onClick}
        style={{
          flex: 1,
          minHeight: 80,
          borderRadius: 22,
          padding: 8,
          background: active
            ? 'linear-gradient(145deg, rgba(37,99,235,0.22), rgba(15,23,42,0.96))'
            : 'linear-gradient(145deg, #0F172A, #020617)',
          border: active
            ? '1px solid rgba(96,165,250,0.85)'
            : '1px solid rgba(148,163,184,0.12)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          transition: 'all 0.25s ease',
          boxShadow: active
            ? '0 0 28px rgba(37,99,235,0.28)'
            : '0 0 0 rgba(0,0,0,0)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            fontSize: 28,
            marginBottom: 10,
          }}
        >
          {emoji}
        </div>
        <div
          style={{
            fontSize: 18,
            fontWeight: 800,
            color: 'white',
            marginBottom: 6,
          }}
        >
          {name}
        </div>
        <div
          style={{
            color: available ? '#60A5FA' : '#94A3B8',
            fontSize: 14,
            fontWeight: 500,
          }}
        >
          {available ? 'Disponível' : 'Em breve'}
        </div>
      </button>
    );
  }

  function InfoCard({ title, value }: { title: string; value: string }) {
    return (
      <div
        style={{
          background: '#0F172A',
          border: '1px solid #1E293B',
          borderRadius: 12,
          padding: 8,
        }}
      >
        <div style={{ color: '#A1A1AA', fontSize: 11 }}>{title}</div>
        <div style={{ fontWeight: 'bold', fontSize: 14, marginTop: 4 }}>
          {value}
        </div>
      </div>
    );
  }

  function MetricCard({ title, value }: { title: string; value: string }) {
    return (
      <div style={metricCardStyle}>
        <div style={{ color: '#A1A1AA', fontSize: 12 }}>{title}</div>
        <div style={{ fontWeight: 'bold', fontSize: 22, marginTop: 6 }}>
          {value}
        </div>
      </div>
    );
  }

  function IconSvg({ children }: any) {
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        {children}
      </svg>
    );
  }

  function DumbbellIcon() {
    return (
      <IconSvg>
        <path
          d="M6 7v10M18 7v10M3 10v4M21 10v4M6 12h12"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
      </IconSvg>
    );
  }

  function HistoryIcon() {
    return (
      <IconSvg>
        <path
          d="M3 12a9 9 0 1 0 3-6.7"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        <path
          d="M3 4v5h5"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M12 7v5l3 2"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
      </IconSvg>
    );
  }

  function ChartIcon() {
    return (
      <IconSvg>
        <path
          d="M4 19V5"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        <path
          d="M4 19h16"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        <path
          d="M7 15l4-4 3 3 5-7"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </IconSvg>
    );
  }

  function UserIcon() {
    return (
      <IconSvg>
        <path
          d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"
          stroke="currentColor"
          strokeWidth="2.2"
        />
        <path
          d="M4 21a8 8 0 0 1 16 0"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
      </IconSvg>
    );
  }
}

const pageStyle: React.CSSProperties = {
  minHeight: '100vh',
  background: '#0B0F19',
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  padding: 0,
  color: 'white',
  fontFamily: 'Arial',
};

const mobilePageStyle: React.CSSProperties = {
  minHeight: '100dvh',
  background: '#0B0F19',
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'stretch',
  color: 'white',
  fontFamily: 'Arial',
  overflow: 'hidden',
};

const appShellStyle: React.CSSProperties = {
  width: 'min(100vw, 430px)',
  minHeight: '100dvh',
  background:
    'radial-gradient(circle at top, rgba(37,99,235,0.16), transparent 34%), #0B0F19',
  display: 'flex',
  flexDirection: 'column',
  position: 'relative',
  overflow: 'hidden',
};

const appContentStyle: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding:
    'calc(28px + env(safe-area-inset-top)) 20px calc(96px + env(safe-area-inset-bottom))',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
};

const splashPageStyle: React.CSSProperties = {
  minHeight: '100vh',
  background:
    'radial-gradient(circle at top, rgba(37,99,235,0.35), transparent 35%), linear-gradient(180deg, #07111F 0%, #0B0F19 100%)',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  alignItems: 'center',
  padding: 24,
  color: 'white',
  fontFamily: 'Arial',
  position: 'relative',
  overflow: 'hidden',
};

const splashGlowStyle: React.CSSProperties = {
  position: 'absolute',
  width: 260,
  height: 260,
  borderRadius: '50%',
  background: 'rgba(37,99,235,0.18)',
  filter: 'blur(40px)',
  top: '26%',
};

const splashLogoCircleStyle: React.CSSProperties = {
  width: 150,
  height: 150,
  borderRadius: 36,
  background: 'linear-gradient(145deg, #0F172A, #020617)',
  border: '1px solid rgba(96,165,250,0.45)',
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  position: 'relative',
  boxShadow: '0 0 40px rgba(37,99,235,0.35)',
  marginBottom: 26,
  animation: 'pulseGlow 1.8s ease-in-out infinite',
};

const splashTitleStyle: React.CSSProperties = {
  fontSize: 44,
  margin: 0,
  letterSpacing: -1,
  fontWeight: 900,
};

const splashSubtitleStyle: React.CSSProperties = {
  marginTop: 22,
  color: '#CBD5E1',
  letterSpacing: 4,
  textTransform: 'uppercase',
  fontSize: 13,
};

const splashFeatureRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 12,
  marginTop: 28,
  fontSize: 12,
  color: '#BFDBFE',
  flexWrap: 'wrap',
  justifyContent: 'center',
};

const splashLoadingTrackStyle: React.CSSProperties = {
  width: 210,
  height: 7,
  background: '#0F172A',
  borderRadius: 999,
  overflow: 'hidden',
  marginTop: 34,
  border: '1px solid #1E293B',
};

const splashLoadingBarStyle: React.CSSProperties = {
  width: '68%',
  height: '100%',
  background: 'linear-gradient(90deg, #2563EB, #60A5FA)',
  borderRadius: 999,
};

const splashLoadingTextStyle: React.CSSProperties = {
  marginTop: 12,
  color: '#94A3B8',
  fontSize: 13,
};

const primaryButtonStyle: React.CSSProperties = {
  width: '100%',
  padding: 14,
  borderRadius: 14,
  border: 'none',
  background: '#2563EB',
  color: 'white',
  fontWeight: 'bold',
  marginTop: 18,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  marginTop: 8,
  padding: '14px 12px',
  borderRadius: 14,
  border: '1px solid #1E293B',
  background: '#020617',
  color: 'white',
  fontSize: 16,
  outline: 'none',
};

const homeButtonStyle: React.CSSProperties = {
  position: 'absolute',
  top: 18,
  left: 18,
  zIndex: 10,
  background: '#2563EB',
  color: 'white',
  border: 'none',
  borderRadius: 14,
  padding: '10px 14px',
  fontWeight: 'bold',
};

const switchCameraButtonStyle: React.CSSProperties = {
  position: 'absolute',
  top: 18,
  right: 18,
  zIndex: 10,
  background: '#111827',
  color: 'white',
  border: '1px solid #3B82F6',
  borderRadius: 14,
  padding: '10px 14px',
  fontWeight: 'bold',
};

const bottomNavStyle: React.CSSProperties = {
  position: 'fixed',
  left: '50%',
  bottom: 0,
  transform: 'translateX(-50%)',
  width: 'min(100vw, 430px)',
  background: 'rgba(15,23,42,0.96)',
  backdropFilter: 'blur(14px)',
  borderTop: '1px solid #1E293B',
  padding: '12px 18px calc(12px + env(safe-area-inset-bottom))',
  display: 'flex',
  justifyContent: 'space-around',
  zIndex: 20,
};

const listCardStyle: React.CSSProperties = {
  background: '#0F172A',
  border: '1px solid #1E293B',
  borderRadius: 16,
  padding: 14,
  marginTop: 12,
};

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr 1fr',
  gap: 8,
  marginBottom: 10,
};

const statsGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 12,
  marginTop: 18,
};

const metricCardStyle: React.CSSProperties = {
  background: '#0F172A',
  border: '1px solid #1E293B',
  borderRadius: 16,
  padding: 14,
};

const chartCardStyle: React.CSSProperties = {
  background: '#0F172A',
  border: '1px solid #1E293B',
  borderRadius: 18,
  padding: 16,
  marginTop: 18,
};

const premiumPageStyle: React.CSSProperties = {
  minHeight: '100dvh',
  background: '#0B0F19',
  display: 'flex',
  flexDirection: 'column',
  padding: '18px 16px',
  color: 'white',
  overflow: 'hidden',
  boxSizing: 'border-box',
};

const premiumTopRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
};

const premiumBrandStyle: React.CSSProperties = {
  fontSize: 26,
  fontWeight: 900,
};

const premiumSkipStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#94A3B8',
  fontSize: 15,
};

const premiumDotsRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  gap: 8,
  marginTop: 10,
  marginBottom: 22,
};

const premiumDotStyle: React.CSSProperties = {
  width: 10,
  height: 10,
  borderRadius: 999,
};

const onboardingMockupCardStyle: React.CSSProperties = {
  background: '#050B18',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 28,
  padding: '20px 18px',
  marginTop: 14,
  height: 'calc(100dvh - 90px)',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'stretch',
  overflow: 'hidden',
  boxSizing: 'border-box',
  boxShadow: '0 0 32px rgba(37,99,235,0.12)',
};

const onboardingStepStyle: React.CSSProperties = {
  color: '#FFFFFF',
  opacity: 0.75,
  fontSize: 15,
  fontWeight: 700,
};

const onboardingMockupTitleStyle: React.CSSProperties = {
  fontSize: 34,
  lineHeight: 1.05,
  marginTop: 18,
  marginBottom: 0,
  fontWeight: 900,
  letterSpacing: -1,
  color: 'white',
  textAlign: 'left',
};

const onboardingMockupDescriptionStyle: React.CSSProperties = {
  color: '#A1A1AA',
  fontSize: 16,
  lineHeight: 1.45,
  marginTop: 14,
  marginBottom: 0,
  maxWidth: 280,
  textAlign: 'left',
};

const onboardingImageFrameStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  marginTop: 12,
  marginBottom: 20,
  overflow: 'hidden',
};

const onboardingMockupImageStyle: React.CSSProperties = {
  width: 300,
  objectFit: 'contain',
  filter: 'drop-shadow(0 0 20px rgba(37,99,235,0.25))',
};

const onboardingMockupButtonStyle: React.CSSProperties = {
  width: '100%',
  height: 56,
  borderRadius: 18,
  border: 'none',
  background: '#2563EB',
  color: 'white',
  fontSize: 18,
  fontWeight: 700,
  marginTop: 6,
  flexShrink: 0,
};
