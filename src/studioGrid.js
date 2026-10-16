import * as THREE from "three";

// libtv er8 grid shaders and uniforms (PI=4, PA=10, PN=9, PD=.3).
export function createStudioGrid() {
  const uniforms = {
    uCellColor: { value: new THREE.Color(2896186) },
    uSectionColor: { value: new THREE.Color(4673115) },
    uAxisXColor: { value: new THREE.Color(0xa8453e) },
    uAxisZColor: { value: new THREE.Color(3957675) },
    uCellSize: { value: 1 },
    uSectionSize: { value: 10 },
    uFadeNear: { value: 10 },
    uFadeFar: { value: 30 },
  };
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.ShaderMaterial({
      uniforms,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      vertexShader: `varying vec3 vWorldPosition;
void main(){vec4 world=modelMatrix*vec4(position,1.0);vWorldPosition=world.xyz;gl_Position=projectionMatrix*viewMatrix*world;}`,
      fragmentShader: `uniform vec3 uCellColor;uniform vec3 uSectionColor;uniform vec3 uAxisXColor;uniform vec3 uAxisZColor;
uniform float uCellSize;uniform float uSectionSize;uniform float uFadeNear;uniform float uFadeFar;varying vec3 vWorldPosition;
float lineCoverage(vec2 plane,float size,float width){vec2 coord=plane/size;vec2 derivative=max(fwidth(coord),vec2(1e-6));
vec2 toLine=abs(fract(coord-0.5)-0.5)/derivative;float line=1.0-min(min(toLine.x,toLine.y)/width,1.0);
float pixelsPerCell=1.0/max(derivative.x,derivative.y);return line*smoothstep(1.5,9.0,pixelsPerCell);}
float axisCoverage(float offset,float width){return 1.0-min(abs(offset)/max(fwidth(offset)*width,1e-6),1.0);}
void main(){vec2 plane=vWorldPosition.xz;float cell=lineCoverage(plane,uCellSize,1.0)*0.5;
float section=lineCoverage(plane,uSectionSize,1.3)*0.85;float axisX=axisCoverage(plane.y,1.5);float axisZ=axisCoverage(plane.x,1.5);
vec3 color=mix(uCellColor,uSectionColor,section);color=mix(color,uAxisZColor,axisZ);color=mix(color,uAxisXColor,axisX);
float alpha=max(max(cell,section),max(axisX,axisZ)*0.95);alpha*=1.0-smoothstep(uFadeNear,uFadeFar,distance(vWorldPosition,cameraPosition));
if(alpha<0.004)discard;gl_FragColor=vec4(color,alpha);
#include <colorspace_fragment>
}`,
    }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = -1;
  mesh.name = "Studio grid";
  return {
    mesh,
    update(camera, target) {
      const distance = Math.max(camera.position.distanceTo(target), 0.01);
      const tier = Math.pow(10, Math.floor(Math.log10(distance / 4))),
        unit = distance / 4 / tier;
      const cellSize = tier * (unit >= 5 ? 5 : unit >= 2 ? 2 : 1);
      uniforms.uCellSize.value = cellSize;
      uniforms.uSectionSize.value = cellSize * 10;
      const fade = Math.max(distance, cellSize) * 9;
      uniforms.uFadeNear.value = fade * 0.3;
      uniforms.uFadeFar.value = fade;
      mesh.position.set(target.x, 0, target.z);
      mesh.scale.setScalar(2 * fade);
    },
  };
}
