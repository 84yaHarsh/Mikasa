import React, { useEffect, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { OrbitControls } from "@react-three/drei";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";

/* ---------------------------------------------------------------
   Arms ko neeche laane ke liye relaxed pose.
   Agar arms galat direction mein jaayein to 70 ke signs flip karo.
---------------------------------------------------------------- */
function applyRelaxedPose(vrm) {
  const humanoid = vrm.humanoid;
  if (!humanoid) return;

  const getBone = (name) => humanoid.getNormalizedBoneNode(name);

  const leftUpperArm = getBone("leftUpperArm");
  const rightUpperArm = getBone("rightUpperArm");
  const leftLowerArm = getBone("leftLowerArm");
  const rightLowerArm = getBone("rightLowerArm");
  const leftHand = getBone("leftHand");
  const rightHand = getBone("rightHand");

  if (leftUpperArm) leftUpperArm.rotation.z = THREE.MathUtils.degToRad(-70);
  if (rightUpperArm) rightUpperArm.rotation.z = THREE.MathUtils.degToRad(70);
  if (leftLowerArm) leftLowerArm.rotation.z = THREE.MathUtils.degToRad(-12);
  if (rightLowerArm) rightLowerArm.rotation.z = THREE.MathUtils.degToRad(12);
  if (leftHand) leftHand.rotation.z = THREE.MathUtils.degToRad(-5);
  if (rightHand) rightHand.rotation.z = THREE.MathUtils.degToRad(5);

  vrm.humanoid.update();
}

function VRMModel({ url, mouthOpen, emotion, headRotation, isSpeaking, onLoaded }) {
  const { gl } = useThree();
  const [vrm, setVrm] = useState(null);
  const vrmRef = useRef(null);

  const blinkTimer = useRef(0);
  const nextBlink = useRef(2 + Math.random() * 3);
  const smoothMouth = useRef(0);

  const mouthKey = useRef("aa");
  const blinkKey = useRef("blink");

  // emotion ka expression map
  const emotionMap = {
    happy: "happy",
    sad: "sad",
    angry: "angry",
    surprised: "surprised",
    relaxed: "relaxed",
    neutral: null,
  };

  useEffect(() => {
    let disposed = false;

    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));

    loader.load(
      url,
      (gltf) => {
        if (disposed) return;
        const loadedVrm = gltf.userData.vrm;

        VRMUtils.removeUnnecessaryVertices(gltf.scene);
        VRMUtils.combineSkeletons(gltf.scene);

        loadedVrm.scene.traverse((obj) => {
          if (!obj.isMesh) return;
          obj.frustumCulled = false;
          const materials = Array.isArray(obj.material)
            ? obj.material
            : [obj.material];
          materials.forEach((mat) => {
            if (!mat) return;
            if (mat.map) mat.map.colorSpace = THREE.SRGBColorSpace;
            if (mat.emissiveMap)
              mat.emissiveMap.colorSpace = THREE.SRGBColorSpace;
            if (mat.shadeMultiplyTexture)
              mat.shadeMultiplyTexture.colorSpace = THREE.SRGBColorSpace;
            mat.needsUpdate = true;
          });
        });

        VRMUtils.rotateVRM0(loadedVrm);
        applyRelaxedPose(loadedVrm);

        // expression names auto-detect
        const expr = loadedVrm.expressionManager;
        if (expr) {
          const names = expr.expressions.map((e) => e.expressionName);
          console.log("Available expressions:", names);
          const mouthCandidates = ["aa", "a", "A", "Aa", "AA", "ah"];
          const found = mouthCandidates.find((n) => names.includes(n));
          if (found) mouthKey.current = found;
          const blinkCandidates = ["blink", "Blink", "blinkLeft"];
          const fb = blinkCandidates.find((n) => names.includes(n));
          if (fb) blinkKey.current = fb;
        }

        vrmRef.current = loadedVrm;
        setVrm(loadedVrm);
        if (onLoaded) onLoaded(loadedVrm);
      },
      undefined,
      (err) => console.error("VRM load error:", err)
    );

    return () => {
      disposed = true;
      if (vrmRef.current) {
        VRMUtils.deepDispose(vrmRef.current.scene);
        vrmRef.current = null;
      }
    };
  }, [url, gl, onLoaded]);

  useFrame((state, delta) => {
    const vrm = vrmRef.current;
    if (!vrm) return;
    const expr = vrm.expressionManager;

    if (expr) {
      /* ---------- LIP SYNC (App se aaya mouthOpen prop) ---------- */
      const target = typeof mouthOpen === "number" ? mouthOpen : 0;
      // smooth karo taaki jhatke na lagein
      smoothMouth.current = THREE.MathUtils.lerp(
        smoothMouth.current,
        target,
        0.5
      );
      expr.setValue(mouthKey.current, THREE.MathUtils.clamp(smoothMouth.current, 0, 1));

      /* ---------- EMOTION ---------- */
      Object.values(emotionMap).forEach((exp) => {
        if (exp) expr.setValue(exp, 0);
      });
      const emoExp = emotionMap[emotion];
      if (emoExp) expr.setValue(emoExp, 0.7);

      /* ---------- AUTO BLINK ---------- */
      blinkTimer.current += delta;
      if (blinkTimer.current > nextBlink.current) {
        const blinkPhase = blinkTimer.current - nextBlink.current;
        const b =
          blinkPhase < 0.075
            ? blinkPhase / 0.075
            : 1 - (blinkPhase - 0.075) / 0.075;
        expr.setValue(blinkKey.current, THREE.MathUtils.clamp(b, 0, 1));
        if (blinkPhase > 0.15) {
          expr.setValue(blinkKey.current, 0);
          blinkTimer.current = 0;
          nextBlink.current = 2 + Math.random() * 3;
        }
      }
    }

    /* ---------- HEAD ROTATION (webcam face tracking) ---------- */
    const head = vrm.humanoid?.getNormalizedBoneNode("head");
    if (head && headRotation) {
      const targetY = THREE.MathUtils.clamp(headRotation.x * 0.5, -0.5, 0.5);
      const targetX = THREE.MathUtils.clamp(headRotation.y * 0.3, -0.3, 0.3);
      head.rotation.y = THREE.MathUtils.lerp(head.rotation.y, targetY, 0.1);
      head.rotation.x = THREE.MathUtils.lerp(head.rotation.x, targetX, 0.1);
    }

    vrm.update(delta);
  });

  if (!vrm) return null;
  return <primitive object={vrm.scene} />;
}

export default function VRMAvatar({
  url = "/mikasa.vrm",
  mouthOpen = 0,
  emotion = "neutral",
  headRotation = { x: 0, y: 0 },
  isSpeaking = false,
  onLoaded,
}) {
  return (
    <Canvas
      flat
      gl={{
        antialias: true,
        alpha: true,
        powerPreference: "high-performance",
      }}
      onCreated={({ gl }) => {
        gl.outputColorSpace = THREE.SRGBColorSpace;
        gl.toneMapping = THREE.NoToneMapping;
        gl.toneMappingExposure = 1.0;
        gl.setClearColor(0x000000, 0);
      }}
      camera={{ position: [0, 1.0, 3.0], fov: 30, near: 0.1, far: 20 }}
      style={{ width: "100%", height: "100%" }}
    >
      <OrbitControls
        target={[0, 0.95, 0]}
        enablePan={false}
        minDistance={1.5}
        maxDistance={5}
      />

      <ambientLight intensity={1.2} color={0xffffff} />
      <directionalLight position={[1, 2, 2]} intensity={1.6} color={0xffffff} />
      <directionalLight position={[-1, 1.5, 1]} intensity={0.6} color={0xffffff} />
      <hemisphereLight args={[0xffffff, 0x444444, 0.5]} />

      <React.Suspense fallback={null}>
        <VRMModel
          url={url}
          mouthOpen={mouthOpen}
          emotion={emotion}
          headRotation={headRotation}
          isSpeaking={isSpeaking}
          onLoaded={onLoaded}
        />
      </React.Suspense>
    </Canvas>
  );
}

