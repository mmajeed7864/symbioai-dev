(() => {
  const intro = document.querySelector("[data-symbio-intro]");
  const canvas = document.querySelector("[data-symbio-intro-canvas]");
  if (!intro || !canvas) return;

  const root = document.documentElement;
  const body = document.body;
  const enter = intro.querySelector("[data-symbio-enter]");
  const skip = intro.querySelector("[data-symbio-skip]");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let finished = false;
  let renderer = null;
  let scene = null;
  let camera = null;
  let logoGroup = null;
  let stageGroup = null;
  let field = null;
  let bars = [];
  let depthPanels = [];
  let targetX = 0;
  let targetY = 0;
  let pointerEnergy = 0;

  root.classList.add("has-symbio-intro");
  body.classList.add("has-symbio-intro");

  const finishIntro = () => {
    if (finished) return;
    finished = true;
    intro.classList.add("is-complete");
    window.setTimeout(() => {
      intro.setAttribute("hidden", "");
      root.classList.remove("has-symbio-intro");
      body.classList.remove("has-symbio-intro");
      if (renderer) renderer.setAnimationLoop(null);
    }, 1180);
  };

  enter?.addEventListener("click", finishIntro);
  skip?.addEventListener("click", finishIntro);

  const armIntro = () => {
    intro.classList.add("is-ready");
  };

  const fallback = () => {
    canvas.setAttribute("data-fallback", "true");
    window.__symbioIntroStats = { mode: "fallback", rendered: true };
    armIntro();
  };

  if (reduceMotion) {
    fallback();
    return;
  }

  const loadThree = async () => {
    try {
      return await import("https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js");
    } catch (error) {
      return null;
    }
  };

  const makeCylinder = (THREE, start, end, radius, material) => {
    const direction = new THREE.Vector3().subVectors(end, start);
    const length = direction.length();
    const geometry = new THREE.CylinderGeometry(radius, radius, length, 10, 1, true);
    const mesh = new THREE.Mesh(geometry, material.clone());
    mesh.position.copy(start).add(end).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    return mesh;
  };

  const makeStrand = (THREE, phase, primary, secondary) => {
    const points = [];
    const steps = 170;
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const angle = t * Math.PI * 4.35 + phase;
      const radius = 1.02 + Math.sin(t * Math.PI * 3) * 0.08;
      const y = (t - 0.5) * 4.35;
      points.push(
        new THREE.Vector3(
          Math.cos(angle) * radius,
          y,
          Math.sin(angle) * radius * 0.52
        )
      );
    }

    const curve = new THREE.CatmullRomCurve3(points);
    const geometry = new THREE.TubeGeometry(curve, 230, 0.038, 12, false);
    const material = new THREE.MeshPhysicalMaterial({
      color: primary,
      emissive: secondary,
      emissiveIntensity: 0.92,
      metalness: 0.25,
      roughness: 0.18,
      clearcoat: 0.75,
      transparent: true,
      opacity: 0.95,
    });
    return { mesh: new THREE.Mesh(geometry, material), points };
  };

  const buildScene = (THREE) => {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(42, 1, 0.1, 80);
    camera.position.set(0, 0.15, 8.2);

    renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8));
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    scene.add(new THREE.AmbientLight(0x86baff, 0.9));
    const key = new THREE.PointLight(0x38e9ff, 18, 18);
    key.position.set(-2.7, 2.7, 4);
    scene.add(key);
    const rim = new THREE.PointLight(0x8b5cff, 22, 20);
    rim.position.set(3, -1.4, 4.8);
    scene.add(rim);

    stageGroup = new THREE.Group();
    stageGroup.position.set(0, -0.16, -0.9);
    scene.add(stageGroup);

    const glassMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x0d1c42,
      emissive: 0x173bff,
      emissiveIntensity: 0.22,
      metalness: 0.28,
      roughness: 0.16,
      clearcoat: 0.9,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
    });
    const lineMaterial = new THREE.LineBasicMaterial({
      color: 0x35eaff,
      transparent: true,
      opacity: 0.42,
      blending: THREE.AdditiveBlending,
    });

    const platform = new THREE.Mesh(
      new THREE.CylinderGeometry(3.1, 3.55, 0.08, 128, 1, true),
      glassMaterial.clone()
    );
    platform.position.set(0, -2.55, 0.1);
    platform.scale.z = 0.34;
    stageGroup.add(platform);

    const platformRing = new THREE.Mesh(
      new THREE.TorusGeometry(3.18, 0.014, 8, 220),
      new THREE.MeshBasicMaterial({
        color: 0x36eaff,
        transparent: true,
        opacity: 0.56,
        blending: THREE.AdditiveBlending,
      })
    );
    platformRing.position.set(0, -2.5, 0.1);
    platformRing.rotation.x = Math.PI / 2;
    platformRing.scale.z = 0.34;
    stageGroup.add(platformRing);

    const volumeFrame = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(5.8, 5.25, 2.3)),
      lineMaterial.clone()
    );
    volumeFrame.position.set(0, 0.05, -0.55);
    volumeFrame.material.opacity = 0.18;
    stageGroup.add(volumeFrame);

    const panelSpecs = [
      { x: -2.85, y: 0.85, z: -1.12, rx: 0.08, ry: 0.62, rz: 0.06, w: 1.62, h: 2.55, color: 0x32e8ff },
      { x: 2.75, y: -0.12, z: -1.05, rx: -0.04, ry: -0.58, rz: -0.08, w: 1.58, h: 2.35, color: 0x7a4cff },
      { x: 0.04, y: 2.42, z: -1.58, rx: 0.58, ry: 0.02, rz: 0, w: 4.85, h: 1.2, color: 0x2f6bff },
    ];
    depthPanels = panelSpecs.map((spec, index) => {
      const group = new THREE.Group();
      const geometry = new THREE.BoxGeometry(spec.w, spec.h, 0.05);
      const material = glassMaterial.clone();
      material.color.setHex(0x071d3a);
      material.emissive.setHex(spec.color);
      material.emissiveIntensity = 0.16 + index * 0.04;
      const panel = new THREE.Mesh(geometry, material);
      const edge = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry),
        new THREE.LineBasicMaterial({
          color: spec.color,
          transparent: true,
          opacity: 0.48,
          blending: THREE.AdditiveBlending,
        })
      );
      group.add(panel, edge);
      group.position.set(spec.x, spec.y, spec.z);
      group.rotation.set(spec.rx, spec.ry, spec.rz);
      group.userData = {
        baseY: spec.y,
        baseRz: spec.rz,
        offset: index * 1.9,
      };
      stageGroup.add(group);
      return group;
    });

    logoGroup = new THREE.Group();
    logoGroup.rotation.z = -0.12;
    logoGroup.position.z = 0.36;
    scene.add(logoGroup);

    const blue = makeStrand(THREE, 0, 0x2f6bff, 0x2eeaff);
    const violet = makeStrand(THREE, Math.PI, 0x8b5cff, 0x714cff);
    logoGroup.add(blue.mesh, violet.mesh);

    const barMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.44,
      blending: THREE.AdditiveBlending,
    });
    for (let i = 12; i < blue.points.length - 12; i += 18) {
      const bar = makeCylinder(THREE, blue.points[i], violet.points[i], 0.016, barMaterial);
      bar.userData.offset = i * 0.031;
      bars.push(bar);
      logoGroup.add(bar);
    }

    const core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.34, 2),
      new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        emissive: 0x35e9ff,
        emissiveIntensity: 1.15,
        metalness: 0.1,
        roughness: 0.06,
        transparent: true,
        opacity: 0.92,
      })
    );
    logoGroup.add(core);

    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0x34e8ff,
      transparent: true,
      opacity: 0.26,
      blending: THREE.AdditiveBlending,
    });
    for (let i = 0; i < 4; i += 1) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(2.05 + i * 0.38, 0.008, 8, 160), ringMaterial.clone());
      ring.rotation.x = Math.PI / 2 + i * 0.21;
      ring.rotation.y = i * 0.62;
      ring.userData.speed = 0.16 + i * 0.04;
      logoGroup.add(ring);
    }

    const particleCount = 520;
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);
    const color = new THREE.Color();
    for (let i = 0; i < particleCount; i += 1) {
      const r = 2.3 + Math.random() * 5.8;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 2 - 1);
      positions[i * 3] = Math.sin(phi) * Math.cos(theta) * r;
      positions[i * 3 + 1] = Math.cos(phi) * r * 0.58;
      positions[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * r - 1.2;
      color.setHSL(0.55 + Math.random() * 0.18, 0.82, 0.56 + Math.random() * 0.28);
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }
    const particleGeometry = new THREE.BufferGeometry();
    particleGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    particleGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    field = new THREE.Points(
      particleGeometry,
      new THREE.PointsMaterial({
        size: 0.028,
        vertexColors: true,
        transparent: true,
        opacity: 0.86,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    scene.add(field);
  };

  const resize = () => {
    if (!renderer || !camera) return;
    const width = Math.max(1, intro.clientWidth);
    const height = Math.max(1, intro.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    const mobile = width < 700;
    if (logoGroup) {
      logoGroup.scale.setScalar(mobile ? 0.54 : 1);
      logoGroup.position.y = mobile ? 1.35 : 0;
    }
    if (stageGroup) {
      stageGroup.scale.setScalar(mobile ? 0.62 : 1);
      stageGroup.position.y = mobile ? 1.08 : -0.16;
    }
    if (camera) camera.position.z = mobile ? 9.5 : 8.2;
  };

  const animate = (THREE) => {
    const clock = new THREE.Clock();
    renderer.setAnimationLoop(() => {
      const elapsed = clock.getElapsedTime();
      if (logoGroup) {
        logoGroup.rotation.y += (targetX * 0.38 - logoGroup.rotation.y) * 0.045;
        logoGroup.rotation.x += (targetY * 0.22 - logoGroup.rotation.x) * 0.045;
        logoGroup.rotation.z = -0.12 + Math.sin(elapsed * 0.55) * 0.035 + pointerEnergy * 0.03;
        logoGroup.children.forEach((child) => {
          if (child.geometry && child.geometry.type === "TorusGeometry") {
            child.rotation.z += child.userData.speed * 0.006;
          }
        });
      }
      if (stageGroup) {
        stageGroup.rotation.y += (targetX * 0.13 - stageGroup.rotation.y) * 0.026;
        stageGroup.rotation.x += (targetY * 0.06 + Math.sin(elapsed * 0.2) * 0.025 - stageGroup.rotation.x) * 0.03;
      }
      depthPanels.forEach((panel, index) => {
        panel.position.y = panel.userData.baseY + Math.sin(elapsed * (0.52 + index * 0.09) + panel.userData.offset) * 0.075;
        panel.rotation.z = panel.userData.baseRz + Math.sin(elapsed * 0.42 + panel.userData.offset) * 0.018;
      });
      if (field) {
        field.rotation.y = elapsed * 0.035;
        field.rotation.x = Math.sin(elapsed * 0.18) * 0.08;
      }
      bars.forEach((bar) => {
        const pulse = (Math.sin(elapsed * 4.2 + bar.userData.offset) + 1) / 2;
        bar.material.opacity = 0.2 + pulse * 0.58;
      });
      pointerEnergy *= 0.92;
      renderer.render(scene, camera);
      window.__symbioIntroStats = {
        mode: "webgl",
        rendered: true,
        width: canvas.width,
        height: canvas.height,
        objects: scene.children.length,
      };
    });
  };

  const bindPointer = () => {
    intro.addEventListener("pointermove", (event) => {
      const rect = intro.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width - 0.5;
      const y = (event.clientY - rect.top) / rect.height - 0.5;
      targetX = x * 2;
      targetY = -y * 2;
      pointerEnergy = Math.min(1, pointerEnergy + 0.08);
    });
    intro.addEventListener("pointerdown", () => {
      pointerEnergy = 1;
      intro.classList.add("is-pulsing");
      window.setTimeout(() => intro.classList.remove("is-pulsing"), 300);
    });
  };

  (async () => {
    const THREE = await loadThree();
    if (!THREE) {
      fallback();
      return;
    }

    try {
      buildScene(THREE);
      resize();
      bindPointer();
      window.addEventListener("resize", resize);
      animate(THREE);
      window.setTimeout(armIntro, 180);
    } catch (error) {
      fallback();
    }
  })();
})();
