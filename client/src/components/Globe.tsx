/**
 * Globe.tsx — Interactive 3D Earth globe using Three.js
 * Design: "Ether" — Dark atmospheric immersion
 * - Earth texture with dark tint
 * - Atmospheric glow halo
 * - Color-coded station markers with pulse animation
 * - Ring pulse effect on selected station
 * - Smooth orbit controls with auto-rotate
 */
import { useEffect, useRef, useCallback } from "react";
import * as THREE from "three";
import { useRadio } from "@/contexts/RadioContext";
import type { Station } from "@/lib/types";
import type { IonosondeStation } from "@/lib/propagationService";
import { getMufColor, getFof2Color } from "@/lib/propagationService";

function latLngToVector3(lat: number, lng: number, radius: number): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -(radius * Math.sin(phi) * Math.cos(theta)),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta)
  );
}

const TYPE_COLORS: Record<string, number> = {
  OpenWebRX: 0x06b6d4,
  WebSDR: 0xff6b6b,
  KiwiSDR: 0x4ade80,
};

const GLOBE_RADIUS = 5;

// Status-aware colors
const STATUS_ONLINE = 0x22c55e; // bright green
const STATUS_OFFLINE = 0xef4444; // red
const STATUS_UNKNOWN_ALPHA = 0.45; // dimmer for unchecked

interface GlobeProps {
  ionosondes?: IonosondeStation[];
  isStationOnline?: (station: Station) => boolean | null;
}

export default function Globe({ ionosondes = [], isStationOnline }: GlobeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const ionoGroupRef = useRef<THREE.Group | null>(null);
  const sceneRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    globe: THREE.Mesh;
    markerGroup: THREE.Group;
    markerMeshes: { mesh: THREE.Mesh; station: Station; baseScale: number }[];
    ringGroup: THREE.Group;
    raycaster: THREE.Raycaster;
    mouse: THREE.Vector2;
    isDragging: boolean;
    dragMoved: boolean;
    previousMouse: THREE.Vector2;
    spherical: THREE.Spherical;
    targetSpherical: THREE.Spherical;
    autoRotate: boolean;
    autoRotateTimer: ReturnType<typeof setTimeout> | null;
    clock: THREE.Clock;
    selectedMeshIdx: number;
    hoverMeshIdx: number;
  } | null>(null);

  const { filteredStations, selectStation, selectedStation, setHoveredStation, globeTarget, clearGlobeTarget } = useRadio();

  const initScene = useCallback(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.set(0, 0, 14);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.4;
    container.appendChild(renderer.domElement);

    // Globe
    const globeGeometry = new THREE.SphereGeometry(GLOBE_RADIUS, 96, 96);
    const globeMaterial = new THREE.MeshPhongMaterial({
      color: 0xbbccdd,
      emissive: 0x112233,
      specular: 0x4488aa,
      shininess: 15,
      transparent: false,
      opacity: 1.0,
    });
    const globe = new THREE.Mesh(globeGeometry, globeMaterial);
    scene.add(globe);

    // Load earth texture
    const textureLoader = new THREE.TextureLoader();
    textureLoader.load(
      "https://unpkg.com/three-globe@2.41.12/example/img/earth-blue-marble.jpg",
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        globeMaterial.map = texture;
        globeMaterial.color.set(0xddddee);
        globeMaterial.needsUpdate = true;
      }
    );

    // Bump map for terrain
    textureLoader.load(
      "https://unpkg.com/three-globe@2.41.12/example/img/earth-topology.png",
      (texture) => {
        globeMaterial.bumpMap = texture;
        globeMaterial.bumpScale = 0.03;
        globeMaterial.needsUpdate = true;
      }
    );

    // Outer atmosphere glow
    const atmosphereGeometry = new THREE.SphereGeometry(GLOBE_RADIUS * 1.18, 64, 64);
    const atmosphereMaterial = new THREE.ShaderMaterial({
      vertexShader: `
        varying vec3 vNormal;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vNormal;
        void main() {
          float intensity = pow(0.6 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 3.5);
          vec3 color = mix(vec3(0.05, 0.6, 0.7), vec3(0.1, 0.2, 0.5), intensity);
          gl_FragColor = vec4(color, intensity * 0.5);
        }
      `,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
    });
    scene.add(new THREE.Mesh(atmosphereGeometry, atmosphereMaterial));

    // Inner atmosphere
    const innerAtmGeometry = new THREE.SphereGeometry(GLOBE_RADIUS * 1.01, 64, 64);
    const innerAtmMaterial = new THREE.ShaderMaterial({
      vertexShader: `
        varying vec3 vNormal;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vNormal;
        void main() {
          float intensity = pow(0.72 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 2.0);
          vec3 color = vec3(0.08, 0.45, 0.55);
          gl_FragColor = vec4(color, intensity * 0.12);
        }
      `,
      blending: THREE.AdditiveBlending,
      side: THREE.FrontSide,
      transparent: true,
      depthWrite: false,
    });
    scene.add(new THREE.Mesh(innerAtmGeometry, innerAtmMaterial));

    // Lighting
    scene.add(new THREE.AmbientLight(0x8899aa, 2.0));
    const dirLight = new THREE.DirectionalLight(0xffffff, 2.5);
    dirLight.position.set(5, 3, 5);
    scene.add(dirLight);
    const fillLight = new THREE.DirectionalLight(0x6688aa, 1.2);
    fillLight.position.set(-3, 1, -3);
    scene.add(fillLight);
    const backLight = new THREE.DirectionalLight(0x334466, 0.8);
    backLight.position.set(-5, -2, -5);
    scene.add(backLight);

    // Starfield background
    const starGeometry = new THREE.BufferGeometry();
    const starCount = 3000;
    const starPositions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount * 3; i += 3) {
      const r = 80 + Math.random() * 120;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      starPositions[i] = r * Math.sin(phi) * Math.cos(theta);
      starPositions[i + 1] = r * Math.sin(phi) * Math.sin(theta);
      starPositions[i + 2] = r * Math.cos(phi);
    }
    starGeometry.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
    const starMaterial = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.15,
      transparent: true,
      opacity: 0.6,
      sizeAttenuation: true,
    });
    scene.add(new THREE.Points(starGeometry, starMaterial));

    // Marker group
    const markerGroup = new THREE.Group();
    scene.add(markerGroup);

    // Ionosonde overlay group
    const ionoGroup = new THREE.Group();
    scene.add(ionoGroup);
    ionoGroupRef.current = ionoGroup;

    // Ring group for selected station pulse
    const ringGroup = new THREE.Group();
    scene.add(ringGroup);

    const spherical = new THREE.Spherical(14, Math.PI / 2.2, 0);
    const targetSpherical = new THREE.Spherical(14, Math.PI / 2.2, 0);

    sceneRef.current = {
      scene,
      camera,
      renderer,
      globe,
      markerGroup,
      markerMeshes: [],
      ringGroup,
      raycaster: new THREE.Raycaster(),
      mouse: new THREE.Vector2(),
      isDragging: false,
      dragMoved: false,
      previousMouse: new THREE.Vector2(),
      spherical,
      targetSpherical,
      autoRotate: true,
      autoRotateTimer: null,
      clock: new THREE.Clock(),
      selectedMeshIdx: -1,
      hoverMeshIdx: -1,
    };

    // Set raycaster threshold for easier picking
    sceneRef.current.raycaster.params.Points = { threshold: 0.1 };

    return () => {
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  // Update markers when filtered stations change
  const updateMarkers = useCallback(() => {
    if (!sceneRef.current) return;
    const { markerGroup } = sceneRef.current;

    // Clear existing markers
    while (markerGroup.children.length > 0) {
      const child = markerGroup.children[0];
      markerGroup.remove(child);
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) child.material.dispose();
      }
    }

    const meshes: { mesh: THREE.Mesh; station: Station; baseScale: number }[] = [];
    const stationsToShow = filteredStations.slice(0, 2000);

    // Create individual meshes for raycasting (instanced mesh raycasting is unreliable)
    const markerGeo = new THREE.SphereGeometry(1, 8, 8);

    stationsToShow.forEach((station) => {
      const [lng, lat] = station.location.coordinates;
      const pos = latLngToVector3(lat, lng, GLOBE_RADIUS * 1.008);
      const primaryType = station.receivers[0]?.type || "WebSDR";
      const typeColor = TYPE_COLORS[primaryType] || TYPE_COLORS.WebSDR;

      // Determine color and opacity based on online status
      let color = typeColor;
      let opacity = 0.85;
      let scale = 0.055;

      if (isStationOnline) {
        const status = isStationOnline(station);
        if (status === true) {
          color = STATUS_ONLINE;
          opacity = 0.95;
          scale = 0.065; // Slightly larger for online stations
        } else if (status === false) {
          color = STATUS_OFFLINE;
          opacity = 0.6;
          scale = 0.045; // Slightly smaller for offline
        } else {
          // null = not yet checked, use type color but dimmer
          opacity = STATUS_UNKNOWN_ALPHA;
        }
      }

      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        depthTest: true,
      });

      const mesh = new THREE.Mesh(markerGeo, mat);
      mesh.scale.set(scale, scale, scale);
      mesh.position.copy(pos);
      mesh.lookAt(0, 0, 0);
      markerGroup.add(mesh);
      meshes.push({ mesh, station, baseScale: scale });
    });

    sceneRef.current.markerMeshes = meshes;
  }, [filteredStations, isStationOnline]);

  useEffect(() => {
    updateMarkers();
  }, [updateMarkers]);

  // Animation loop
  useEffect(() => {
    const cleanup = initScene();
    if (!sceneRef.current) return cleanup;

    const s = sceneRef.current;
    let animationId: number;

    const animate = () => {
      animationId = requestAnimationFrame(animate);
      if (!sceneRef.current) return;

      const delta = s.clock.getDelta();
      const elapsed = s.clock.getElapsedTime();

      // Auto-rotate
      if (s.autoRotate && !s.isDragging) {
        s.targetSpherical.theta += delta * 0.06;
      }

      // Smooth interpolation
      s.spherical.theta += (s.targetSpherical.theta - s.spherical.theta) * 0.06;
      s.spherical.phi += (s.targetSpherical.phi - s.spherical.phi) * 0.06;
      s.spherical.radius += (s.targetSpherical.radius - s.spherical.radius) * 0.08;

      s.spherical.phi = Math.max(0.3, Math.min(Math.PI - 0.3, s.spherical.phi));
      s.spherical.radius = Math.max(7, Math.min(30, s.spherical.radius));

      s.camera.position.setFromSpherical(s.spherical);
      s.camera.lookAt(0, 0, 0);

      // Pulse selected marker
      const pulse = 1 + Math.sin(elapsed * 3) * 0.3;
      s.markerMeshes.forEach(({ mesh, baseScale }, idx) => {
        if (idx === s.selectedMeshIdx) {
          const sc = baseScale * 2.5 * pulse;
          mesh.scale.set(sc, sc, sc);
          (mesh.material as THREE.MeshBasicMaterial).opacity = 1;
        } else if (idx === s.hoverMeshIdx) {
          const sc = baseScale * 1.8;
          mesh.scale.set(sc, sc, sc);
          (mesh.material as THREE.MeshBasicMaterial).opacity = 1;
        } else {
          mesh.scale.set(baseScale, baseScale, baseScale);
          (mesh.material as THREE.MeshBasicMaterial).opacity = 0.85;
        }
      });

      // Animate ring pulse for selected station
      s.ringGroup.children.forEach((child) => {
        if (child instanceof THREE.Mesh) {
          const mat = child.material as THREE.MeshBasicMaterial;
          const scale = child.scale.x + delta * 2;
          if (scale > 3) {
            child.scale.set(0.1, 0.1, 0.1);
            mat.opacity = 0.6;
          } else {
            child.scale.set(scale, scale, scale);
            mat.opacity = Math.max(0, 0.6 - (scale / 3) * 0.6);
          }
        }
      });

      s.renderer.render(s.scene, s.camera);
    };

    animate();

    return () => {
      cancelAnimationFrame(animationId);
      cleanup?.();
    };
  }, [initScene]);

  // Create ring pulse at selected station
  const createRingPulse = useCallback((station: Station) => {
    if (!sceneRef.current) return;
    const { ringGroup } = sceneRef.current;

    // Clear existing rings
    while (ringGroup.children.length > 0) {
      const child = ringGroup.children[0];
      ringGroup.remove(child);
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) child.material.dispose();
      }
    }

    const [lng, lat] = station.location.coordinates;
    const pos = latLngToVector3(lat, lng, GLOBE_RADIUS * 1.009);

    // Create 3 concentric rings
    for (let i = 0; i < 3; i++) {
      const ringGeo = new THREE.RingGeometry(0.08, 0.12, 32);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0xff6b6b,
        transparent: true,
        opacity: 0.5,
        side: THREE.DoubleSide,
        depthTest: false,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.copy(pos);
      ring.lookAt(0, 0, 0);
      const initScale = 0.1 + i * 0.8;
      ring.scale.set(initScale, initScale, initScale);
      ringGroup.add(ring);
    }
  }, []);

  // Mouse/touch interaction handlers
  useEffect(() => {
    if (!containerRef.current || !sceneRef.current) return;
    const container = containerRef.current;
    const s = sceneRef.current;

    const resetAutoRotate = () => {
      if (s.autoRotateTimer) clearTimeout(s.autoRotateTimer);
      s.autoRotate = false;
      s.autoRotateTimer = setTimeout(() => {
        if (!s.isDragging) s.autoRotate = true;
      }, 6000);
    };

    const onMouseDown = (e: MouseEvent) => {
      s.isDragging = true;
      s.dragMoved = false;
      s.previousMouse.set(e.clientX, e.clientY);
    };

    const onMouseMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      s.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      s.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      if (s.isDragging) {
        const deltaX = e.clientX - s.previousMouse.x;
        const deltaY = e.clientY - s.previousMouse.y;
        if (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2) s.dragMoved = true;

        s.targetSpherical.theta -= deltaX * 0.005;
        s.targetSpherical.phi -= deltaY * 0.005;
        s.previousMouse.set(e.clientX, e.clientY);
        resetAutoRotate();
      } else {
        // Hover detection
        s.raycaster.setFromCamera(s.mouse, s.camera);
        const meshes = s.markerMeshes.map((m) => m.mesh);
        const intersects = s.raycaster.intersectObjects(meshes);
        if (intersects.length > 0) {
          const hitMesh = intersects[0].object;
          const idx = s.markerMeshes.findIndex((m) => m.mesh === hitMesh);
          if (idx >= 0) {
            s.hoverMeshIdx = idx;
            container.style.cursor = "pointer";
            setHoveredStation(s.markerMeshes[idx].station);
          }
        } else {
          s.hoverMeshIdx = -1;
          container.style.cursor = s.isDragging ? "grabbing" : "grab";
          setHoveredStation(null);
        }
      }
    };

    const onMouseUp = () => {
      s.isDragging = false;
      container.style.cursor = "grab";
    };

    const onClick = (e: MouseEvent) => {
      if (s.dragMoved) return; // Ignore clicks after drag

      const rect = container.getBoundingClientRect();
      s.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      s.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      s.raycaster.setFromCamera(s.mouse, s.camera);
      const meshes = s.markerMeshes.map((m) => m.mesh);
      const intersects = s.raycaster.intersectObjects(meshes);

      if (intersects.length > 0) {
        const hitMesh = intersects[0].object;
        const idx = s.markerMeshes.findIndex((m) => m.mesh === hitMesh);
        if (idx >= 0) {
          const station = s.markerMeshes[idx].station;
          s.selectedMeshIdx = idx;
          selectStation(station);
          createRingPulse(station);

          // Rotate to center on station
          const [lng, lat] = station.location.coordinates;
          const phi = (90 - lat) * (Math.PI / 180);
          const theta = -(lng) * (Math.PI / 180);
          s.targetSpherical.phi = phi;
          s.targetSpherical.theta = theta;
          resetAutoRotate();
        }
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      s.targetSpherical.radius += e.deltaY * 0.008;
      resetAutoRotate();
    };

    // Touch support
    let touchStart: { x: number; y: number } | null = null;
    let lastTouchDist = 0;
    let touchMoved = false;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        s.isDragging = true;
        touchMoved = false;
        touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        s.previousMouse.set(e.touches[0].clientX, e.touches[0].clientY);
      } else if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        lastTouchDist = Math.sqrt(dx * dx + dy * dy);
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      if (e.touches.length === 1 && s.isDragging) {
        const deltaX = e.touches[0].clientX - s.previousMouse.x;
        const deltaY = e.touches[0].clientY - s.previousMouse.y;
        if (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2) touchMoved = true;
        s.targetSpherical.theta -= deltaX * 0.005;
        s.targetSpherical.phi -= deltaY * 0.005;
        s.previousMouse.set(e.touches[0].clientX, e.touches[0].clientY);
        resetAutoRotate();
      } else if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        s.targetSpherical.radius += (lastTouchDist - dist) * 0.02;
        lastTouchDist = dist;
        resetAutoRotate();
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length === 0) {
        if (touchStart && !touchMoved) {
          const endX = e.changedTouches[0].clientX;
          const endY = e.changedTouches[0].clientY;
          const rect = container.getBoundingClientRect();
          s.mouse.x = ((endX - rect.left) / rect.width) * 2 - 1;
          s.mouse.y = -((endY - rect.top) / rect.height) * 2 + 1;
          s.raycaster.setFromCamera(s.mouse, s.camera);
          const meshes = s.markerMeshes.map((m) => m.mesh);
          const intersects = s.raycaster.intersectObjects(meshes);
          if (intersects.length > 0) {
            const hitMesh = intersects[0].object;
            const idx = s.markerMeshes.findIndex((m) => m.mesh === hitMesh);
            if (idx >= 0) {
              const station = s.markerMeshes[idx].station;
              s.selectedMeshIdx = idx;
              selectStation(station);
              createRingPulse(station);
              const [lng, lat] = station.location.coordinates;
              s.targetSpherical.phi = (90 - lat) * (Math.PI / 180);
              s.targetSpherical.theta = -(lng) * (Math.PI / 180);
              resetAutoRotate();
            }
          }
        }
        s.isDragging = false;
        touchStart = null;
      }
    };

    const onResize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      s.camera.aspect = w / h;
      s.camera.updateProjectionMatrix();
      s.renderer.setSize(w, h);
    };

    container.addEventListener("mousedown", onMouseDown);
    container.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    container.addEventListener("click", onClick);
    container.addEventListener("wheel", onWheel, { passive: false });
    container.addEventListener("touchstart", onTouchStart, { passive: true });
    container.addEventListener("touchmove", onTouchMove, { passive: false });
    container.addEventListener("touchend", onTouchEnd);
    window.addEventListener("resize", onResize);

    return () => {
      container.removeEventListener("mousedown", onMouseDown);
      container.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      container.removeEventListener("click", onClick);
      container.removeEventListener("wheel", onWheel);
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchmove", onTouchMove);
      container.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("resize", onResize);
      if (s.autoRotateTimer) clearTimeout(s.autoRotateTimer);
    };
  }, [selectStation, setHoveredStation, createRingPulse]);

  // Update selected marker index when selectedStation changes externally
  useEffect(() => {
    if (!sceneRef.current) return;
    const s = sceneRef.current;
    if (selectedStation) {
      const idx = s.markerMeshes.findIndex(
        (m) =>
          m.station.label === selectedStation.label &&
          m.station.location.coordinates[0] === selectedStation.location.coordinates[0] &&
          m.station.location.coordinates[1] === selectedStation.location.coordinates[1]
      );
      s.selectedMeshIdx = idx;
      if (idx >= 0) {
        createRingPulse(selectedStation);
        // Rotate to station
        const [lng, lat] = selectedStation.location.coordinates;
        s.targetSpherical.phi = (90 - lat) * (Math.PI / 180);
        s.targetSpherical.theta = -(lng) * (Math.PI / 180);
      }
    } else {
      s.selectedMeshIdx = -1;
      // Clear rings
      while (s.ringGroup.children.length > 0) {
        const child = s.ringGroup.children[0];
        s.ringGroup.remove(child);
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (child.material instanceof THREE.Material) child.material.dispose();
        }
      }
    }
  }, [selectedStation, createRingPulse]);

  // Render ionosonde markers on globe
  useEffect(() => {
    const ionoGroup = ionoGroupRef.current;
    if (!ionoGroup) return;

    // Clear existing ionosonde markers
    while (ionoGroup.children.length > 0) {
      const child = ionoGroup.children[0];
      ionoGroup.remove(child);
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) child.material.dispose();
      }
    }

    if (ionosondes.length === 0) return;

    // Diamond-shaped marker for ionosondes (rotated square)
    const diamondGeo = new THREE.CircleGeometry(0.06, 4);

    // Halo ring around each ionosonde
    const haloGeo = new THREE.RingGeometry(0.08, 0.12, 16);

    ionosondes.forEach((iono) => {
      if (iono.mufd == null && iono.fof2 == null) return;
      const colorStr = iono.mufd != null ? getMufColor(iono.mufd) : getFof2Color(iono.fof2!);
      const color = new THREE.Color(colorStr);
      const pos = latLngToVector3(iono.lat, iono.lon, GLOBE_RADIUS * 1.012);
      const stale = iono.ageMinutes > 120;

      // Diamond marker
      const markerMat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: stale ? 0.3 : 0.9,
        side: THREE.DoubleSide,
        depthTest: true,
      });
      const marker = new THREE.Mesh(diamondGeo, markerMat);
      marker.position.copy(pos);
      marker.lookAt(0, 0, 0);
      // Rotate 45 degrees to make diamond shape
      marker.rotateZ(Math.PI / 4);
      ionoGroup.add(marker);

      // Glow halo
      const haloMat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: stale ? 0.08 : 0.25,
        side: THREE.DoubleSide,
        depthTest: false,
      });
      const halo = new THREE.Mesh(haloGeo, haloMat);
      halo.position.copy(pos);
      halo.lookAt(0, 0, 0);
      ionoGroup.add(halo);
    });
  }, [ionosondes]);

  // Auto-rotate globe to continent/region when globeTarget changes
  useEffect(() => {
    if (!sceneRef.current || !globeTarget) return;
    const s = sceneRef.current;
    const { lat, lng, zoom } = globeTarget;

    // Convert lat/lng to spherical coordinates
    s.targetSpherical.phi = (90 - lat) * (Math.PI / 180);
    s.targetSpherical.theta = -(lng) * (Math.PI / 180);

    // Adjust zoom (camera distance)
    if (zoom !== undefined) {
      s.targetSpherical.radius = 14 * (1 / zoom);
    }

    // Pause auto-rotate briefly so the fly-to animation is smooth
    s.autoRotate = false;
    if (s.autoRotateTimer) clearTimeout(s.autoRotateTimer);
    s.autoRotateTimer = setTimeout(() => {
      s.autoRotate = true;
    }, 8000);

    clearGlobeTarget();
  }, [globeTarget, clearGlobeTarget]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 w-full h-full z-[5]"
      style={{ cursor: "grab" }}
    />
  );
}
