var streams = [];
var fadeInterval = 1.6;
var mySymbolSize = 14;


var myCanvas;
var t = 1;
var REALISTIC_CRT_EFFECT_SHADER;
var REALISTIC_CRT_EFFECT_SOURCE_CODE = `#version 100
precision highp float;

uniform sampler2D tex0      ;
varying vec2      vTexCoord ;
uniform float     time      ;
uniform vec2      resolution;

const float scan_line_amount  = 1.0;
const float warp_amount  = 0.1;
const float noise_amount  = 0.03;
const float interference_amount  = 0.2;
const float grille_amount  = 0.1;
const float grille_size  = 1.0;
const float vignette_amount  = 0.6;
const float vignette_intensity  = 0.4;
const float aberation_amount  = 0.5;
const float roll_line_amount  = 0.3;
const float roll_speed  = 1.0;
const float scan_line_strength  = -8.0;
const float pixel_strength  = -2.0;
const float PI = 3.14;

float random(vec2 uv){
    return fract(cos(uv.x * 83.4827 + uv.y * 92.2842) * 43758.5453123);
}

vec3 fetch_pixel(vec2 uv, vec2 off){
	vec2 pos = floor(uv * resolution + off) / resolution + vec2(0.5) / resolution;

	float noise = 0.0;
	if(noise_amount > 0.0){
		noise = random(pos + fract(time)) * noise_amount;
	}

	if(max(abs(pos.x - 0.5), abs(pos.y - 0.5)) > 0.5){
		return vec3(0.0, 0.0, 0.0);
	}

	vec3 clr = texture2D(tex0 , pos, -16.0).rgb + noise;
	return clr;
}

// Distance in emulated pixels to nearest texel.
vec2 Dist(vec2 pos){ 
	pos = pos * resolution;
	return - ((pos - floor(pos)) - vec2(0.5));
}

// 1D Gaussian.
float Gaus(float pos, float scale){ return exp2(scale * pos * pos); }

// 3-tap Gaussian filter along horz line.
vec3 Horz3(vec2 pos, float off){
	vec3 b = fetch_pixel(pos, vec2(-1.0, off));
	vec3 c = fetch_pixel(pos, vec2( 0.0, off));
	vec3 d = fetch_pixel(pos, vec2( 1.0, off));
	float dst = Dist(pos).x;
	
	// Convert distance to weight.
	float scale = pixel_strength;
	float wb = Gaus(dst - 1.0, scale);
	float wc = Gaus(dst + 0.0, scale);
	float wd = Gaus(dst + 1.0, scale);
	
	// Return filtered sample.
	return (b * wb + c * wc + d * wd) / (wb + wc + wd);
}

// Return scanline weight.
float Scan(vec2 pos, float off){
	float dst = Dist(pos).y;
	
	return Gaus(dst + off, scan_line_strength);
}


// Allow nearest three lines to effect pixel.
vec3 Tri(vec2 pos){
	vec3 clr = fetch_pixel(pos, vec2(0.0));
	if(scan_line_amount > 0.0){
		vec3 a = Horz3(pos,-1.0);
		vec3 b = Horz3(pos, 0.0);
		vec3 c = Horz3(pos, 1.0);

		float wa = Scan(pos,-1.0);
		float wb = Scan(pos, 0.0);
		float wc = Scan(pos, 1.0);

		vec3 scanlines = a * wa + b * wb + c * wc;
		clr = mix(clr, scanlines, scan_line_amount);
	}
	return clr;
}

// Takes in the UV and warps the edges, creating the spherized effect
vec2 warp(vec2 uv){
	vec2 delta = uv - 0.5;
	float delta2 = dot(delta.xy, delta.xy);
	float delta4 = delta2 * delta2;
	float delta_offset = delta4 * warp_amount;
	
	vec2 warped = uv + delta * delta_offset;
	return (warped - 0.5) / mix(1.0,1.2,warp_amount/5.0) + 0.5;
}

float vignette(vec2 uv){
	uv *= 1.0 - uv.xy;
	float vignette = uv.x * uv.y * 15.0;
	return pow(vignette, vignette_intensity * vignette_amount);
}

float floating_mod(float a, float b){
	return a - b * floor(a/b);
}

vec3 grille(vec2 uv){
	float unit = PI / 3.0;
	float scale = 2.0*unit/grille_size;
	float r = smoothstep(0.5, 0.8, cos(uv.x*scale - unit));
	float g = smoothstep(0.5, 0.8, cos(uv.x*scale + unit));
	float b = smoothstep(0.5, 0.8, cos(uv.x*scale + 3.0*unit));
	return mix(vec3(1.0), vec3(r,g,b), grille_amount);
}

float roll_line(vec2 uv){
	float x = uv.y * 3.0 - time * roll_speed;
	float f = cos(x) * cos(x * 2.35 + 1.1) * cos(x * 4.45 + 2.3);
	float roll_line = smoothstep(0.5, 0.9, f);
	return roll_line * roll_line_amount;
}

void main() {
  vec2 pix = gl_FragCoord.xy;
	vec2 pos = warp(vTexCoord);
	
	float line = 0.0;
	if(roll_line_amount > 0.0){
		line = roll_line(pos);
	}

	vec2 sq_pix = floor(pos * resolution) / resolution + vec2(0.5) / resolution;
	if(interference_amount + roll_line_amount > 0.0){
		float interference = random(sq_pix.yy + fract(time));
		pos.x += (interference * (interference_amount + line * 6.0)) / resolution.x;
	}

	vec3 clr = Tri(pos);
	if(aberation_amount > 0.0){
		float chromatic = aberation_amount + line * 2.0;
		vec2 chromatic_x = vec2(chromatic,0.0) / resolution.x;
		vec2 chromatic_y = vec2(0.0, chromatic/2.0) / resolution.y;
		float r = Tri(pos - chromatic_x).r;
		float g = Tri(pos + chromatic_y).g;
		float b = Tri(pos + chromatic_x).b;
		clr = vec3(r,g,b);
	}
	
	if(grille_amount > 0.0)clr *= grille(pix);
	clr *= 1.0 + scan_line_amount * 0.6 + line * 3.0 + grille_amount * 2.0;
	if(vignette_amount > 0.0)clr *= vignette(pos);
	
	gl_FragColor.rgb = clr;
	gl_FragColor.a = 1.0;
}
`;
var SHOCK_WAVE_SHADER;
var SHOCK_WAVE_SHADER_SOURCE_CODE = `
#version 100

precision highp float;

uniform sampler2D tex0;
varying vec2 vTexCoord;


uniform vec2 aspect;
uniform float t;
uniform vec2 centre;

const float maxRadius = 0.5 / 2.0;

// SDF from https://iquilezles.org/articles/distfunctions2d/
float sdBox(vec2 p, vec2 b) {
    vec2 d = abs(p)-b;
    return length(max(d,0.0)) + min(max(d.x,d.y),0.0);
}

float getOffsetStrength(float t, vec2 dir) {
  float d = length(dir/aspect) - t * maxRadius; // SDF of circle
  // Doesn't have to be a circle!!
  // float d = sdBox(dir/aspect, vec2(t * maxRadius));
  
  d *= 1. - smoothstep(0., 0.05, abs(d)); // Mask the ripple
  
  d *= smoothstep(0., 0.05, t); // Smooth intro
  d *= 1. - smoothstep(0.5, 1., t); // Smooth outro
  return d;
}

void main() {
  // 0. Normal sampling
  // colour = texture2D(tex0, vTexCoord);
  
  // 1. Simple distortion
  // float x = sin(vTexCoord.y * 12.56) * 0.02 * smoothstep(vTexCoord.y - 0.3, vTexCoord.y, t);
  // float y = sin(vTexCoord.x * 12.56) * 0.02;
  // vec2 offset = vec2(x, y);
  // colour = texture2D(tex0, vTexCoord + offset);
  
  // 2. Shockwave
  // vec2 centre = vec2(0.5);
  // vec2 dir = centre - vTexCoord;
  // float d = length(dir/aspect) - t * maxRadius;//0.2; // SDF of circle
  // d *= 1. - smoothstep(0., 0.05, abs(d)); // Smooth the ripple
  // dir = normalize(dir);
  // colour = texture2D(tex0, vTexCoord + dir * d);
  

  // 3. Animation
  // vec2 dir = centre - vTexCoord;
  // float d = getOffsetStrength(t, dir);
  // dir = normalize(dir);
  // colour = texture(image, vTexCoord + dir * d);
  
  // 4. Chromatic aberation
  vec2 dir = centre - vTexCoord;
  float tOffset = 0.05 * sin(t * 3.14);
  float rD = getOffsetStrength(t + tOffset, dir);
  float gD = getOffsetStrength(t          , dir);
  float bD = getOffsetStrength(t - tOffset, dir);
  
  dir = normalize(dir);
  
  float r = texture2D(tex0, vTexCoord + dir * rD).r;
  float g = texture2D(tex0, vTexCoord + dir * gD).g;
  float b = texture2D(tex0, vTexCoord + dir * bD).b;
  
  float shading = gD * 8.;
  
  gl_FragColor      = vec4(r, g, b, 1.);
  gl_FragColor.rgb +=
      shading ;
}
`;

function setup() {
    myCanvas = createCanvas(window.innerWidth / 2, window.innerHeight / 2, "WEBGL");
    myCanvas.position(0, 0);


    background(0);
    REALISTIC_CRT_EFFECT_SHADER = createFilterShader(REALISTIC_CRT_EFFECT_SOURCE_CODE);
    SHOCK_WAVE_SHADER = createFilterShader(SHOCK_WAVE_SHADER_SOURCE_CODE);


    var x = 0;
    for (var i = 0; i <= width / mySymbolSize; i++) {
        var stream = new Stream();
        stream.generateMySymbols(x, random(-2000, 0));
        streams.push(stream);
        x += mySymbolSize;
    }

    textFont("Consolas");
    textSize(mySymbolSize);
}





function draw() {
    background(0, 150);
    streams.forEach(function (stream) {
        stream.render();
    });


    REALISTIC_CRT_EFFECT_SHADER.setUniform("time", millis());
    REALISTIC_CRT_EFFECT_SHADER.setUniform("resolution", [width, height]);
    filter(REALISTIC_CRT_EFFECT_SHADER);


    SHOCK_WAVE_SHADER.setUniform("t", pow(t, 1 / 1.5));
    SHOCK_WAVE_SHADER.setUniform("aspect", [1, width / height]);
    if (t < 1) {
        t += 0.01;
    }
    filter(SHOCK_WAVE_SHADER);
}





function MySymbol(x, y, speed, first, opacity) {
    this.x = x;
    this.y = y;
    this.value;


    this.speed = speed;
    this.first = first;
    this.opacity = opacity;


    this.switchInterval = round(random(2, 25));


    this.setToRandomMySymbol = function () {
        var charType = round(random(0, 5));
        if (frameCount % this.switchInterval == 0) {
            if (charType > 1) {
                // set it to Katakana
                this.value = String.fromCharCode(
                    0x30A0 + floor(random(0, 97))
                );
            } else {
                // set it to numeric
                this.value = floor(random(0, 10));
            }
        }
    }


    this.rain = function () {
        this.y = (this.y >= height) ? 0 : this.y += this.speed;
    }

}





function Stream() {
    this.mySymbols = [];
    this.totalMySymbols = round(random(5, 35));
    this.speed = random(5, 22);


    this.generateMySymbols = function (x, y) {
        var opacity = 255;
        var first = round(random(0, 4)) == 1;
        for (var i = 0; i <= this.totalMySymbols; i++) {
            mySymbol = new MySymbol(
                x,
                y,
                this.speed,
                first,
                opacity
            );
            mySymbol.setToRandomMySymbol();
            this.mySymbols.push(mySymbol);
            opacity -= (255 / this.totalMySymbols) / fadeInterval;
            y -= mySymbolSize;
            first = false;
        }
    }


    this.render = function () {
        this.mySymbols.forEach(function (mySymbol) {
            if (mySymbol.first) {
                fill(140, 255, 170, mySymbol.opacity);
            } else {
                fill(0, 255, 70, mySymbol.opacity);
            }
            text(mySymbol.value, mySymbol.x, mySymbol.y);
            mySymbol.rain();
            mySymbol.setToRandomMySymbol();
        });
    }
}





function mouseReleased() {
    setCentreToMouse();
    t = 0;
}





function setCentreToMouse() {
    SHOCK_WAVE_SHADER.setUniform("centre", [mouseX / width, mouseY / height]);
}





//https://godotshaders.com/shader/realistic-crt-shader/
//https://github.com/emilyxxie/green_rain
//https://editor.p5js.org/BarneyCodes/sketches/ELbA93Ugb


// var video;
// video = createVideo(
//     'https://upload.wikimedia.org/wikipedia/commons/d/d2/DiagonalCrosswalkYongeDundas.webm'
//   );
//   video.volume(0);
//   video.hide();
//   video.loop();

// background(255);
//   push();
//   imageMode(CENTER);
//   image(video, 0, 0, width, height, 0, 0, video.width, video.height, COVER);
//   pop();

// var img;
// function preload()
// {
//     img = loadImage("/pexels-wojciech-kumpicki-1084687-2071882.jpg");
// }
// img = loadImage();
// createCanvas(img.width, img.height);
// image(img, 0, 0, width, height);
