
// register jQuery plugin for game / init game
$.fn.walkabout = function() {

if(this.data("_walkaboutGame")) {
	return this.data("_walkaboutGame");
}

// utility objects
var stagingCanvas = $("<canvas>")[0];
var stagingContext = stagingCanvas.getContext("2d");

// global state
var w; // "world"
var gameDiv = this; // tag to find resources under
var keys = {
	left: false,
	right: false,
	up: false,
	down: false
};

// ===================================================================
// GAME ENGINE
var rooms = {}
var spritesheets = {}
var actors = {}
var globalProps = {};

var World, Room, Actor

// WORLD
World = function() {
	// PC
	this.pc = false;
	
	// conversation state
	this.inConvo = false;
	this.convoLine = null;
	
	// transition state
	this.transitionAction = null;
	this.fade = 0;
	
	// graphics
	this.canvas = null;
	this.cx = null;

	// misc global
	this.nextId = 0;
	this.animateTick = 0;
	this.night = 0;
}
// API
World.prototype.sheet = function(name, selector, spriteW, spriteH) {

	var sheet = spritesheets[name]
	
	if(!sheet) {
		sheet = {
			img: null,
			spriteW: -1,
			spriteH: -1
		}
		spritesheets[name] = sheet;
	}
	
	if(selector) {
		sheet.img = gameDiv.find(selector)[0];
		sheet.w = spriteW;
		sheet.h = spriteH;
		sheet.cols = sheet.img.width / spriteW;
	}
	
	return sheet;
}
World.prototype.room = function(name, bgSelector, maskSelector) {

	var room = rooms[name]
	
	if(!room) {
		room = new Room(name);
		rooms[name] = room;
	}
	
	if(bgSelector) {
		room.setBg(bgSelector, maskSelector);
	}
	
	return room;
}
World.prototype.prop = function(actorName, r,g,b) {
	// a prop is a single actor located everywhere the room mask is a given color.
	// it generally lacks a room of its own
	
	globalProps[r+","+g+","+b] = actorName;
}
World.prototype.actor = function(name, sheetName, baseFrame, pose) {
	//console.log( "make " + name + " at " + x + ","+y);
	var actor = actors[name]
	
	if(!actor) {
		actor = new Actor(name);
		actors[name] = actor;
	}

	if(sheetName != null) actor.setSkin(sheetName, baseFrame, pose);

	return actor;
}
World.prototype.convo = function(selector) {
	if(selector == false) {
		endConvo();
	} else {
		var ul = $(selector);
		showConvo(ul.children("li:first-of-type"));
	}
}
// Convenience API funcs
World.prototype.onTalk = function(selector, func) {
	var lines = $(selector);
	lines.on("shown", func);
}
World.prototype.afterTalk = function(selector, func) {
	var lines = $(selector);
	lines.on("dismissed", func);
}
World.prototype.examine = function(name, convoSelector) {
	w.actor(name).onAction = function(player) {
		w.convo(convoSelector);
	};
}
World.prototype.npc = function(name, convoSelector) {
	w.actor(name).onAction = function(player) {
		this.face(player);
		w.convo(convoSelector);
	};
}
World.prototype.trigger = function(name, func) {
	var prop = w.actor(name);
	prop.tangible = false;
	if(typeof func == "string") {
		prop.onBump = function() {
			w.convo(func);
		};
	} else if(func == false) {
		prop.onBump = function() {};
	} else {
		prop.onBump = func;
	}
}
World.prototype.warp = function(name, targetRoom, x, y, poseOrWalkX, walkY) {
	var warpActor = this.actor(name);
	
	// allow disabling
	if(targetRoom == false) {
		warpActor.onBump = function() {}
		return warpActor;
	}
	
	warpActor.onBump = function(player) {
		w.transitionAction = function() {
			player.setRoom(targetRoom);
			player.warp(x,y);
			if(poseOrWalkX != null) {
				if(walkY != null) {
					player.walk(poseOrWalkX, walkY);
				} else {
					player.setSkin(null, null, poseOrWalkX);
				}
			}
		}
	};
	
	return warpActor;
}

// internals
World.prototype.drawSprite = function(name, frame, x,y) {
	var sheet = this.sheet(name);
	
	if(sheet.img) {
		var w = sheet.w;
		var h = sheet.h;

		var row = ~~(frame / sheet.cols);
		var col = frame % sheet.cols;
		
		var bx = col * w;
		var by = row * h;
	
		this.cx.drawImage(sheet.img,
		bx, by, w, h,
		x, y, w, h);
	}
}

w = new World();

// ROOMS
Room = function(name) {
	this.name = name;

	// grid cell size
	this.cw = 32;
	this.ch = 32;

	this.bg = null;
	this.mask = null;
	
	this.props = {}
	
	// grid
	this.grid = {};
	
	// effect
	this.night = 0;
}
// API
Room.prototype.prop = function(actorName, r,g,b) {
	// a prop is a single actor located everywhere the room mask is a given color.
	// it generally lacks a room of its own
	
	this.props[r+","+g+","+b] = actorName;
	return w.actor(actorName);
}
// internals
Room.prototype.setBg = function(bgSelector, maskSelector) {
	if(maskSelector == null) maskSelector = bgSelector;

	// bg image
	this.bg = $(bgSelector)[0]

	// collision mask for walls/etc
	var mask = $(maskSelector)[0]
	stagingCanvas.width = mask.width
	stagingCanvas.height = mask.height
	stagingContext.drawImage(mask, 0,0);
	this.mask = stagingContext.getImageData(0,0, mask.width, mask.height);
	
	// visible grid size
	this.w = ~~(this.bg.width / this.cw);
	this.h = ~~(this.bg.height / this.ch);
}
Room.prototype.getGrid = function(x,y) {
	var result = this.grid[x+","+y];
	
	if(result == null) {
		// see if catchall object defined for given bgcolor in square
		
		// prevent wrapping off edges when looking up a value
		if(x < 0 || x >= this.w) return null;
		if(y < 0 || y >= this.h) return null;
		
		// calc pixel coords of a spot in the given grid square on the mask
		// assumes grid square is at least 3x3
		var mx = (x * this.cw) + 1;
		var my = (y * this.ch) + 1;
		
		var data = this.mask.data;
		var offset = ((my * this.mask.width) + mx) * 4;
		var color = data[offset+0]+","+data[offset+1]+","+data[offset+2];
		//console.log("mask color @ "+mx+","+my+" or "+offset+" = "+color)
		
		var propName = this.props[color];
		if(propName == null) propName = globalProps[color];
		
		if(propName != null) result = w.actor(propName);
		//console.log("propName = "+propName)
	}
	
	return result;
}
Room.prototype.setGrid = function(x,y, actor) {
	if(actor == null) {
		delete this.grid[x+","+y];
	} else {
		this.grid[x+","+y] = actor;
	}
}
Room.prototype.each = function(func) {
	var g = this.grid;
	for(var k in g) {
		func(g[k])
	}
}
Room.prototype.tick = function() {
	this.each(function(actor) {
		actor.tick();
	});
}
Room.prototype.render = function(offX, offY) {
	w.canvas[0].width = this.bg.width;
	w.canvas[0].height = this.bg.height;

	var cx = w.cx;
	cx.save();
		cx.drawImage(this.bg, 0,0);

		// sort actors so as to draw ones near the bottom on top of further-up ones
		var actors = [];

		this.each(function(actor) {
			actors.push(actor);
		});
		
		actors.sort(function(a,b) {
			return a.y - b.y;
		});
		
		for(var i = 0; i < actors.length; i++) {
			actors[i].render();
		}
		
	cx.restore();
}

// ACTORS
Actor = function(name) {
	this.name = name
	
	// grid location
	this.room = null;
	this.x = 0;
	this.y = 0;
	
	// current pose frame (toggles between it & next up for animation)
	this.baseFrame = 0;
	this.pose = 0;
	this.sheetName = "";
	this.sheet = null;
	
	// sprite offset for tuning effects
	this.xOffset = 0;
	this.yOffset = 0;
	
	// walk-into-cell animation offset
	this.ax = 0;
	this.ay = 0;
}
Actor.prototype.walkSpeed = 0.15; // speed to move, units-per-tick
Actor.prototype.tangible = true; // has a grid location & collision detection
Actor.prototype.startMove = function() {
	if(this.room && this.tangible) this.room.setGrid(this.x, this.y, null);
}
Actor.prototype.endMove = function() {
	if(this.room && this.tangible) this.room.setGrid(this.x, this.y, this);
}
Actor.prototype.setRoom = function(roomName) {
	this.startMove();
	this.room = w.room(roomName);
	this.endMove();

	return this;
}
Actor.prototype.warp = function(x, y, roomName) {

	this.startMove();

	if(roomName != null) this.room = w.room(roomName);

	this.x = x;
	this.y = y;
	this.ax = 0;
	this.ay = 0;

	this.endMove();

	return this;
}
Actor.prototype.walk = function(x, y) {
	var oldX = this.x + this.ax;
	var oldY = this.y + this.ay;

	this.startMove();
	this.x = x;
	this.y = y;
	this.ax = oldX - x;
	this.ay = oldY - y;
	this.endMove();
	
	return this;
}
Actor.prototype.setSkin = function(sheetName, baseFrame, pose) {
	if(baseFrame != null) this.baseFrame = baseFrame;
	if(pose != null) this.pose = pose;
	if(sheetName != null) this.sheetName = sheetName;
	this.sheet = w.sheet(this.sheetName);

	return this;
}
Actor.prototype.render = function() {
	var frame = this.baseFrame + this.pose + (w.animateTick % 2);
	
	if(this.room && this.sheet) {
		var room = this.room;
		var sheet = this.sheet;
		var baseX = (this.x + this.ax + this.xOffset + 0.5) * room.cw;
		var baseY = (this.y + this.ay + this.yOffset+ 1) * room.ch;
		var x = baseX - sheet.w/2;
		var y = baseY - sheet.h;
		
		this.renderEffectBelow(baseX,baseY);
	}
	
	w.drawSprite(this.sheetName, frame, x,y);
	//console.log("draw "+this.name+" "+x+","+y+" "+this.x+","+this.y)
}
Actor.prototype.renderEffectBelow = function(x, y) {}
Actor.prototype.think = function() {}
Actor.prototype.faceForward = function() {
	// util func, ensure sprite matches movement direction
	this.faceDir(-this.ax, -this.ay);
	return this;
}
Actor.prototype.face = function(actor) {
	this.faceDir(actor.x - this.x, actor.y - this.y);
	return this;
}
Actor.prototype.faceDir = function(dx, dy) {
	if(dy < 0) this.pose = 0;
	else if(dy > 0) this.pose = 2;
	else if(dx < 0) this.pose = 4;
	else if(dx > 0) this.pose = 6;

	return this;
}
Actor.prototype.currentFaceX = function() {
		if(this.pose < 2) return 0;
		if(this.pose < 4) return 0;
		if(this.pose < 6) return -1;
		if(this.pose < 8) return 1;
		return 0; // ???
}
Actor.prototype.currentFaceY = function() {
		if(this.pose < 2) return -1;
		if(this.pose < 4) return 1;
		if(this.pose < 6) return 0;
		if(this.pose < 8) return 0;
		return 0; // ???
}
Actor.prototype.tick = function() {
	// finish walking to next grid cell
	// TODO: freezes each step due to walkspeed not evenly dividing grid (binary vs decimal fractions)
	if(this.ax < 0) this.ax = Math.min(this.ax + this.walkSpeed, 0);
	if(this.ax > 0) this.ax = Math.max(this.ax - this.walkSpeed, 0);
	if(this.ay < 0) this.ay = Math.min(this.ay + this.walkSpeed, 0);
	if(this.ay > 0) this.ay = Math.max(this.ay - this.walkSpeed, 0);
	
	// control
	if(this.ax == 0 && this.ay == 0 && w.fade == 0 && !w.inConvo) {
		if(w.pc == this) {
			// key control
			var keyX = 0, keyY = 0;
			if(keys.left) keyX--;
			if(keys.right) keyX++;
			if(keys.up) keyY--;
			if(keys.down) keyY++;
			
			// bar diagonal motion, favor current orientation
			if(this.pose < 4 && keyY != 0) {
				keyX = 0;
			} else if(this.pose >= 4 && keyX != 0) {
				keyY = 0;
			}
			
			var tx = this.x + keyX;
			var ty = this.y + keyY;
			
			// handle collision
			var inWay = this.room.getGrid(tx, ty);
			var toBump = null;
			if(inWay) {
				// queue "interact" event
				toBump = inWay;
				
				if(inWay.tangible) {
					// maybe moved?
					inWay = this.room.getGrid(tx, ty);
				} else {
					// intangible, can step over just fine
					inWay = null;
				}
			}
			
			// if way forward now clear
			if(inWay == null) {
				this.walk(tx, ty);
				this.faceForward()
			} else {
				this.faceDir(keyX, keyY);
			}
			
			// fire "interact" event
			if(toBump) {
				toBump.onBump(this);
			}
			
		} else {
			// ai control
			this.think();
		}
	}
}
Actor.prototype.doContextAction = function() {
	// (only ever triggered for PC)
	// done walking?
	if(this.ax == 0 && this.ay == 0) {
		var target = this.room.getGrid(this.x + this.currentFaceX(), this.y + this.currentFaceY());
		
		if(target) {
			target.onAction(this);
		}
	}
}
Actor.prototype.onBump = function(playerChar) {/*hook*/}
Actor.prototype.onAction = function(playerChar) {/*hook*/}

// main game loop func
var subAnimationTicks = 0;
var gameLoop = function() {
	// input
	
	// update
	if(w.pc) {
		
		// fade transition
		if(w.transitionAction) {
			w.fade += 0.1;
			if(w.fade >= 1) {
				w.fade = 1;
				w.transitionAction();
				w.transitionAction = null;
			}
		} else if(w.fade > 0) {
			w.fade -= 0.1;
			if(w.fade <= 0) {
				w.fade = 0;
			}
		}
		
		w.pc.room.tick();
	}

	// render
	subAnimationTicks++;
	if(subAnimationTicks >= 10) {
		w.animateTick++;
		subAnimationTicks = 0;
	}
	
	if(w.pc) {
		// draw current room
		w.pc.room.render()
		
		// transition
		var cx = w.cx;
		var c = w.canvas[0];
		
		var fade = Math.max(w.fade, w.night * w.pc.room.night);
		if(fade > 0) {
			cx.fillStyle = "rgba(0,0,0,"+fade.toFixed(2)+")"
			cx.fillRect(0,0,c.width, c.height);
			//console.log(cx.fillStyle+" rgba(0,0,0,"+w.fade.toFixed(2)+")");
		}
	}
}

// ===================================================================
// CONVERSATION UTILITIES

function showConvo(li) {
	
	var oldLine = w.convoLine;

	if(li.length == 0) {
		endConvo();
		return;
	}
	w.inConvo = true;
	w.convoLine = li;

	var convoSlot = w.convoSlot;
	convoSlot.empty();
	convoSlot.append(li.clone());
	
	if(oldLine) {
		oldLine.triggerHandler("dismissed");
	}
	li.triggerHandler("shown");
}
function nextConvo() {
	// do nothing if interrupting scene change
	if(w.fade > 0) return;

	// advance through conversation
	var li = w.convoLine;
	
	var next = li.next();
	
	if(next.length > 0) {
		showConvo(next);
	} else {
		// at end, clear unless links are in this line (used for branching, etc)
		var links = li.find("a");
		if(links.length == 0) {
			endConvo();
		}
	}
}
function endConvo() {
	w.inConvo = false;
	var oldLine = w.convoLine;
	w.convoLine = null;
	
	var convoSlot = w.convoSlot;
	convoSlot.empty();

	if(oldLine) {
		oldLine.triggerHandler("dismissed");
	}
}

// ===================================================================

// setup tags
var canvasTag = $("<canvas>");
w.canvas = canvasTag;
w.cx = canvasTag[0].getContext("2d");
canvasTag.show();

gameDiv.append(canvasTag);

var convoSlot = $("<ul>");
w.convoSlot = convoSlot;
convoSlot.addClass("walkabout_convoSlot");

gameDiv.append(convoSlot);

// register listeners
var setKey = function(e, state) {
	if (e.which == 32) { // space
		if(state == false) { // keyup
			if(w.inConvo) {
				nextConvo();
			} else if(w.pc) {
				w.pc.doContextAction();
			}
		}
		e.preventDefault();
	} else if (e.which == 37) { // left
		keys.left = state
		e.preventDefault();
	} else if (e.which == 38) { // up
		keys.up = state
		e.preventDefault();
	} else if (e.which == 39) { // right
		keys.right = state
		e.preventDefault();
	} else if (e.which == 40) { // down
		keys.down = state
		e.preventDefault();
	}
}
$(document).keydown(function(e){
	setKey(e, true);
});
$(document).keyup(function(e){
	setKey(e, false);
});

this.on("click", "li", function(event) {
	// if click was a link, ignore, unless class was "next" where default behavor
	var link = $(event.target).filter("a");
	if(link.length > 0) {
		if(link.hasClass("done")) {
			endConvo();
			return;
		}
		if(!link.hasClass("next")) {
			return;
		}
	}

	// disable advance-on-click for now
	//nextConvo();
});

// setup game loop
setInterval(gameLoop, 1000/30);

// save context
this.data("_walkaboutGame", w)

// NOT chainable!
return w;

};


