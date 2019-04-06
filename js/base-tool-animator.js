function baseToolAnimator () {
	function cleanNulls (obj) {
		Object.entries(obj).filter(([k, v]) => v == null).forEach(([k]) => delete obj[k]);
		return obj;
	}

	d20plus.anim = {
		deserialize: function (json) {
			let out;
			switch (json._type) {
				case "Nop":
					out = new d20plus.anim.Nop();
					break;
				case "Move": {
					out = new d20plus.anim.Move(json.startTime, json.duration, json.x, json.y, json.z);
					out._progress = json._progress;
					break;
				}
				case "Copy": {
					out = new d20plus.anim.Copy(json.startTime, json.childAnimationUid);
					break;
				}
				case "Rotate": {
					out = new d20plus.anim.Rotate(json.startTime, json.duration, json.degrees);
					out._progress = json._progress;
					break;
				}
				case "Flip": {
					out = new d20plus.anim.Rotate(json.startTime, json.isHorizontal, json.isVertical);
					break;
				}
				case "Scale": {
					out = new d20plus.anim.Scale(json.startTime, json.duration, json.scaleFactorX, json.scaleFactorY);
					out._progress = json._progress;
					break;
				}
				case "Layer": {
					out = new d20plus.anim.Layer(json.startTime, json.layer);
					break;
				}
				case "SetProperty": {
					out = new d20plus.anim.SetProperty(json.startTime, json.prop, json.value);
					break;
				}
				case "Lighting": {
					out = new d20plus.anim.Lighting(json.startTime, json.duration, json.lightRadius, json.dimStart, json.degrees);
					out._progress = json._progress;
					break;
				}
				case "TriggerMacro": {
					out = new d20plus.anim.TriggerMacro(json.startTime, json.macroName);
					break;
				}
				case "TriggerAnimation": {
					out = new d20plus.anim.TriggerAnimation(json.startTime, json.animationUid);
					break;
				}
			}
			out._hasRun = json._hasRun;
			out._offset = json._offset;
			return out;
		},

		// region animations
		// Each has `animate` which accepts up to four parameters:
		//   token: the token object being animated
		//   alpha: the absolute time since the start of the animation's life
		//   delta: the time delta from the last time the `animate` function was run
		//   queue: the queue this animation is part of
		// The `animate` function returns `true` if the token needs to be saved, `false` otherwise
		// Each should also have:
		//   `serialize` function
		//   `hasRun` function; returns `true` if the animation has been run, and can therefore be safely removed from any queues
		//   `setOffset` function; sets a start time offset for the animation. Used when triggering child animations
		_Base: function () {
			this._hasRun = false;
			this._offset = 0;
			this._progress = 0; // 0 - 1f

			this.hasRun = () => this._hasRun;
			this.setOffset = offset => this._offset = offset;
			this._serialize = () => ({
				_type: this.constructor.name,
				_hasRun: this._hasRun,
				_offset: this._offset,
				_progress: this._progress
			});

			this._getTickProgress = (duration, delta) => {
				let mProgress = duration === 0 ? 1 : Math.min(1, delta / duration);
				// prevent progress from going past 100%
				if (this._progress + mProgress > 1) mProgress = 1 - this._progress;
				return mProgress;
			};
		},

		Nop: function () {
			d20plus.anim._Base.call(this);

			this.animate = function () {
				return false;
			};

			this.hasRun = () => true;
			this.serialize = () => {};
		},

		Move: function (startTime, duration, x, y, z) {
			d20plus.anim._Base.call(this);

			this.animate = function (token, alpha, delta) {
				alpha = alpha - this._offset;

				if (alpha >= startTime) {
					if (this._progress < (1 - Number.EPSILON)) {
						const mProgress = this._getTickProgress(duration, delta);

						// handle movement
						const mvX = mProgress * x;
						const mvY = mProgress * y;

						token.attributes.left += mvX;
						token.attributes.top -= mvY;

						if (z != null) {
							const statuses = token.get("statusmarkers").split(",");
							let total = 0;
							let pow = 1;
							let out = "";

							// reverse loop through the fluffy wings, multiplying vals by 1/10/100...
							const len = statuses.length;
							for (let i = len - 1; i >= 0; --i) {
								const [name, val] = statuses[i].split("@");
								if (name === "fluffy-wing") {
									total += pow * Number(val);
									pow = pow * 10;
								} else {
									out += statuses[i] + ",";
								}
							}

							total += mProgress * z;
							const nums = String(total).split("");
							for (let i = 0; i < nums.length; ++i) {
								out += `fluffy-wings@${nums[i]}${i < nums.length - 1 ? "," : ""}`;
							}

							token.set("statusmarkers", out);
						}

						// update progress
						this._progress += mProgress;

						return true;
					} else this._hasRun = true;
				}
				return false;
			};

			this.serialize = () => {
				return cleanNulls({
					...this._serialize(),
					startTime, duration, x, y, z
				})
			};
		},

		Copy: function (startTime, childAnimationUid = false) {
			d20plus.anim._Base.call(this);

			this.animate = function (token, alpha, delta, queue) {
				alpha = alpha - this._offset;

				if (!this._hasRun && alpha >= startTime) {
					this._hasRun = true;

					// based on "d20.clipboard.doCopy"
					const graphic = token.view.graphic;
					const attrs = {
						...MiscUtil.copy(graphic)
					};

					const modelattrs = {};
					const json = token.toJSON();
					d20.token_editor.tokenkeys.forEach(k => modelattrs[k] = json[k]);

					const cpy = {
						type: token.attributes.type,
						attrs,
						modelattrs,
						oldid: token.id,
						groupwith: ""
					};

					// based on "d20.clipboard.doPaste"
					let childToken;
					const page = d20.Campaign.pages.models.find(model => model.thegraphics.models.find(it => it.id === token.id));
					if ("image" === cpy.type) {
						attrs.imgsrc = attrs.src;
						childToken = page.addImage(attrs, true, false, false, false, true);
						if (cpy.modelattrs && cpy.modelattrs.represents) {
							const char = d20.Campaign.characters.get(cpy.modelattrs.represents);

							if (char) {
								const updateBarN = (n) => {
									const prop = `bar${n}_link`;
									if ("" !== cpy.modelattrs[prop] && (-1 !== cpy.modelattrs[prop].indexOf("sheetattr_"))) {
										const l = cpy.modelattrs[prop].split("sheetattr_")[1];
										setTimeout(() => char.updateTokensByName(l), 0.5);
									} else {
										const s = char.attribs.get(cpy.modelattrs[prop]);
										const l = s.get("name");
										setTimeout(() => char.updateTokensByName(l, cpy.modelattrs[prop]), 0.5);
									}
								};
								updateBarN(1);
								updateBarN(2);
								updateBarN(3);
							}
						}

						childToken && childToken.save(cpy.modelattrs);
					}

					if (childToken && childAnimationUid) {
						const nxt = new d20plus.anim.TriggerAnimation(startTime, childAnimationUid);
						nxt.animate(childToken, alpha, delta, queue);
					}
				}
				return false;
			};

			this.serialize = () => {
				return cleanNulls({
					...this._serialize(),
					startTime, childAnimationUid
				})
			};
		},

		Rotate: function (startTime, duration, degrees) {
			d20plus.anim._Base.call(this);

			this.animate = function (token, alpha, delta) {
				alpha = alpha - this._offset;

				if (alpha >= startTime) {
					if (this._progress < (1 - Number.EPSILON)) {
						const mProgress = this._getTickProgress(duration, delta);

						// handle rotation
						const rot = mProgress * degrees;
						token.attributes.rotation += rot;

						// update progress
						this._progress += mProgress;

						return true;
					} else this._hasRun = true;
				}
				return false;
			};

			this.serialize = () => {
				return cleanNulls({
					...this._serialize(),
					startTime, duration, degrees
				})
			};
		},

		Flip: function (startTime, isHorizontal, isVertical) {
			d20plus.anim._Base.call(this);

			this.animate = function (token, alpha) {
				alpha = alpha - this._offset;

				if (!this._hasRun && alpha >= startTime) {
					this._hasRun = true;

					if (isHorizontal) token.attributes.fliph = !(typeof token.attributes.fliph === "string" ? token.attributes.fliph === "true" : token.attributes.fliph);
					if (isVertical) token.attributes.flipv = !(typeof token.attributes.flipv === "string" ? token.attributes.flipv === "true" : token.attributes.flipv);

					return true;
				}
				return false;
			};

			this.serialize = () => {
				return cleanNulls({
					...this._serialize(),
					startTime, isHorizontal, isVertical
				})
			};
		},

		Scale: function (startTime, duration, scaleFactorX, scaleFactorY) {
			d20plus.anim._Base.call(this);

			this.animate = function (token, alpha, delta) {
				alpha = alpha - this._offset;

				if (alpha >= startTime) {
					if (this._progress < (1 - Number.EPSILON)) {
						const mProgress = this._getTickProgress(duration, delta);

						// handle scaling
						const mScaleX = mProgress * scaleFactorX;
						const mScaleY = mProgress * scaleFactorY;

						token.view.graphic.scaleX = Number(token.view.graphic.scaleX || 0) + mScaleX;
						token.view.graphic.scaleY = Number(token.view.graphic.scaleY || 0) + mScaleY;
						token.attributes.scaleX = token.view.graphic.scaleX;
						token.attributes.scaleY = token.view.graphic.scaleY;

						// update progress
						this._progress += mProgress;

						return true;
					} else this._hasRun = true;
				}
				return false;
			};

			this.serialize = () => {
				return cleanNulls({
					...this._serialize(),
					startTime, duration, scaleFactorX, scaleFactorY
				})
			};
		},

		Layer: function (startTime, layer) {
			d20plus.anim._Base.call(this);

			this.animate = function (token, alpha) {
				alpha = alpha - this._offset;

				if (!this._hasRun && alpha >= startTime) {
					this._hasRun = true;

					token.attributes.layer = layer;

					return true;
				}
				return false;
			};

			this.serialize = () => {
				return cleanNulls({
					...this._serialize(),
					startTime, layer
				})
			};
		},

		// TODO consider making an alternate version which sets a property on the character
		// TODO consider the ability to set properties on _other_ tokens -- might not be performant enough?
		SetProperty: function (startTime, prop, value) {
			d20plus.anim._Base.call(this);

			this.animate = function (token, alpha) {
				alpha = alpha - this._offset;

				if (!this._hasRun && alpha >= startTime) {
					this._hasRun = true;

					if (prop === "gmnotes") value = escape(value);
					else if (prop === "sides") value = value.split("|").map(it => escape(it)).join("|");
					token.attributes[prop] = value;

					return true;
				}
				return false;
			};

			this.serialize = () => {
				return cleanNulls({
					...this._serialize(),
					startTime, prop, value
				})
			};
		},

		Lighting: function (startTime, duration, lightRadius, dimStart, degrees) {
			d20plus.anim._Base.call(this);

			this.animate = function (token, alpha, delta) {
				alpha = alpha - this._offset;

				if (alpha >= startTime) {
					if (this._progress < (1 - Number.EPSILON)) {
						const mProgress = this._getTickProgress(duration, delta);

						// handle lighting changes
						const mLightRadius = mProgress * lightRadius;
						token.attributes.light_radius = Number(token.attributes.light_radius || 0) + mLightRadius;

						if (dimStart != null) {
							const mDimStart = mProgress * dimStart;
							token.attributes.light_dimradius = Number(token.attributes.light_dimradius || 0) + mDimStart;
						}

						if (degrees != null) {
							const mDegrees = mProgress * degrees;
							if (token.attributes.light_angle === "") token.attributes.light_angle = 360;
							token.attributes.light_angle = Number(token.attributes.light_angle || 0) + mDegrees;
						}

						// update progress
						this._progress += mProgress;

						return true;
					} else this._hasRun = true;
				}
				return false;
			};

			this.serialize = () => {
				return cleanNulls({
					...this._serialize(),
					startTime, duration, lightRadius, dimStart, degrees
				})
			};
		},

		TriggerMacro: function (startTime, macroName) {
			d20plus.anim._Base.call(this);

			this.animate = function (token, alpha) {
				alpha = alpha - this._offset;

				if (!this._hasRun && alpha >= startTime) {
					this._hasRun = true;

					d20.textchat.doChatInput(`#${macroName}`)
				}
				return false;
			};

			this.serialize = () => {
				return cleanNulls({
					...this._serialize(),
					startTime, macroName
				})
			};
		},

		TriggerAnimation: function (startTime, animationUid) {
			d20plus.anim._Base.call(this);

			this.animate = function (token, alpha, delta, queue) {
				alpha = alpha - this._offset;

				if (!this._hasRun && alpha >= startTime) {
					this._hasRun = true;

					const anim = d20plus.anim.animatorTool.getAnimation(animationUid);

					if (!anim) return false; // if it has been deleted/etc

					const nxtQueue = d20plus.anim.animatorTool.getAnimQueue(anim);
					nxtQueue.forEach(it => it.setOffset(alpha + this._offset));
					queue.push(...nxtQueue);
				}
				return false;
			};

			this.serialize = () => {
				return cleanNulls({
					...this._serialize(),
					startTime, animationUid
				})
			};
		}
		// endregion animations
	};

	function Command (line, error, cons = null) {
		this.line = line;
		this.error = error;
		this.isRunnable = !!cons;

		this.getInstance = function () {
			return new cons();
		};
	}

	Command.errInvalidArgCount = function (line, ...counts) { return new Command(line, `Invalid argument count; expected ${counts.joinConjunct(", ", " or ")}`)};
	Command.errPropNum = function (line, prop, val) { return new Command(line, `${prop} "${val}" was not a number`)};
	Command.errPropBool = function (line, prop, val) { return new Command(line, `${prop} "${val}" was not a boolean`)};
	Command.errPropLayer = function (line, prop, val) { return new Command(line, `${prop} "${val}" was not a layer (valid layers are: ${d20plus.anim._LAYERS.joinConjunct(", ", " or ")})`)};
	Command.errPropToken = function (line, prop, val) { return new Command(line, `${prop} "${val}" was not a token property`)};
	Command.errValNeg = function (line, prop, val) { return new Command(line, `${prop} "${val}" was negative`)};

	Command.errStartNum = function (line, val) { return Command.errPropNum(line, "start time", val)};
	Command.errStartNeg = function (line, val) { return Command.errValNeg(line, "start time", val)};
	Command.errDurationNum = function (line, val) { return Command.errPropNum(line, "duration", val)};
	Command.errDurationNeg = function (line, val) { return Command.errValNeg(line, "duration", val)};

	Command.fromString = function (line) {
		const cleanLine = line
			.split("/\/\//g")[0] // handle comments
			.trim();
		const tokens = cleanLine.split(/ +/g).filter(Boolean);
		if (!tokens.length) return new Command(line);

		const op = tokens.shift();
		switch (op) {
			case "mv": {
				if (tokens.length < 4 || tokens.length > 5) return Command.errInvalidArgCount(line, 4, 5);
				const nStart = Number(tokens[0]);
				if (isNaN(nStart)) return Command.errStartNum(line, tokens[0]);
				if (nStart < 0) return Command.errStartNeg(line, tokens[0]);
				const nDuration = Number(tokens[1]);
				if (isNaN(nDuration)) return Command.errDurationNum(line, tokens[1]);
				if (nDuration < 0) return Command.errDurationNeg(line, tokens[1]);
				const nX = Number(tokens[2]);
				if (isNaN(nX)) return Command.errPropNum(line, "x", tokens[2]);
				const nY = Number(tokens[3]);
				if (isNaN(nY)) return Command.errPropNum(line, "y", tokens[3]);
				const nZ = tokens[4] ? Number(tokens[4]) : null;
				if (nZ != null && isNaN(nY)) return Command.errPropNum(line, "z", tokens[4]);

				return new Command(
					line,
					null,
					d20plus.anim.Move.bind(null, nStart, nDuration, nX, nY, nZ)
				);
			}

			case "rot": {
				if (tokens.length !== 3) return Command.errInvalidArgCount(line, 3);
				const nStart = Number(tokens[0]);
				if (isNaN(nStart)) return Command.errStartNum(line, tokens[0]);
				if (nStart < 0) return Command.errStartNeg(line, tokens[0]);
				const nDuration = Number(tokens[1]);
				if (isNaN(nDuration)) return Command.errDurationNum(line, tokens[1]);
				if (nDuration < 0) return Command.errDurationNeg(line, tokens[1]);
				const nRot = Number(tokens[2]);
				if (isNaN(nRot)) return Command.errPropNum(line, "degrees", tokens[2]);

				return new Command(
					line,
					null,
					d20plus.anim.Rotate.bind(null, nStart, nDuration, nRot)
				);
			}

			case "cp": {
				if (tokens.length < 1 || tokens.length > 2) return Command.errInvalidArgCount(line, 1, 2);
				const nStart = Number(tokens[0]);
				if (isNaN(nStart)) return Command.errStartNum(line, tokens[0]);
				if (nStart < 0) return Command.errStartNeg(line, tokens[0]);

				const anim = tokens[1] ? d20plus.anim.animatorTool.getAnimations().find(it => it.name === tokens[1]) : null;
				if (!anim && tokens[1]) return new Command(line, `Could not find animation "${tokens[1]}"`, tokens[1]);

				return new Command(
					line,
					null,
					d20plus.anim.Copy.bind(null, nStart, anim ? anim.uid : null)
				);
			}

			case "flip": {
				if (tokens.length !== 3) return Command.errInvalidArgCount(line, 3);
				const nStart = Number(tokens[0]);
				if (isNaN(nStart)) return Command.errStartNum(line, tokens[0]);
				if (nStart < 0) return Command.errStartNeg(line, tokens[0]);
				const flipH = tokens[1] === "true" ? true : tokens[1] === "false" ? false : null;
				if (flipH == null) return Command.errPropBool(line, "flipH", tokens[1]);
				const flipV = tokens[2] === "true" ? true : tokens[2] === "false" ? false : null;
				if (flipV == null) return Command.errPropBool(line, "flipV", tokens[2]);

				return new Command(
					line,
					null,
					d20plus.anim.Flip.bind(null, nStart, flipH, flipV)
				);
			}

			case "scale": {
				if (tokens.length !== 4) return Command.errInvalidArgCount(line, 4);
				const nStart = Number(tokens[0]);
				if (isNaN(nStart)) return Command.errStartNum(line, tokens[0]);
				if (nStart < 0) return Command.errStartNeg(line, tokens[0]);
				const nDuration = Number(tokens[1]);
				if (isNaN(nDuration)) return Command.errDurationNum(line, tokens[1]);
				if (nDuration < 0) return Command.errDurationNeg(line, tokens[1]);
				const nScaleX = Number(tokens[2]);
				if (isNaN(nScaleX)) return Command.errPropNum(line, "scaleX", tokens[2]);
				if (nScaleX < 0) return Command.errValNeg(line, "scaleX", tokens[2]);
				const nScaleY = Number(tokens[3]);
				if (isNaN(nScaleY)) return Command.errPropNum(line, "scaleY", tokens[3]);
				if (nScaleY < 0) return Command.errValNeg(line, "scaleY", tokens[3]);

				return new Command(
					line,
					null,
					d20plus.anim.Scale.bind(null, nStart, nDuration, nScaleX, nScaleY)
				);
			}

			case "layer": {
				if (tokens.length !== 2) return Command.errInvalidArgCount(line, 2);
				const nStart = Number(tokens[0]);
				if (isNaN(nStart)) return Command.errStartNum(line, tokens[0]);
				if (nStart < 0) return Command.errStartNeg(line, tokens[0]);
				if (!d20plus.anim.VALID_LAYER.has(tokens[1])) return Command.errPropLayer(line, "layer", tokens[1]);

				return new Command(
					line,
					null,
					d20plus.anim.Layer.bind(null, nStart, tokens[1])
				);
			}

			case "light": {
				if (tokens.length < 3 || tokens.length > 5) return Command.errInvalidArgCount(line, 3, 4, 5);
				const nStart = Number(tokens[0]);
				if (isNaN(nStart)) return Command.errStartNum(line, tokens[0]);
				if (nStart < 0) return Command.errStartNeg(line, tokens[0]);
				const nDuration = Number(tokens[1]);
				if (isNaN(nDuration)) return Command.errDurationNum(line, tokens[1]);
				if (nDuration < 0) return Command.errDurationNeg(line, tokens[1]);
				const nLightRadius = Number(tokens[2]);
				if (isNaN(nLightRadius)) return Command.errPropNum(line, "lightRadius", tokens[2]);
				const nDimStart = tokens[3] ? Number(tokens[3]) : null;
				if (nDimStart != null && isNaN(nDimStart)) return Command.errPropNum(line, "dimStart", tokens[3]);
				const nDegrees = tokens[4] ? Number(tokens[4]) : null;
				if (nDegrees != null && isNaN(nDegrees)) return Command.errPropNum(line, "degrees", tokens[4]);
				if (nDegrees != null && nDegrees < 0) return Command.errValNeg(line, "degrees", tokens[4]); //  TODO is this required?

				return new Command(
					line,
					null,
					d20plus.anim.Lighting.bind(null, nStart, nDuration, nLightRadius, nDimStart, nDegrees)
				);
			}

			case "prop": {
				if (tokens.length < 2) return Command.errInvalidArgCount(line, 3);
				const nStart = Number(tokens[0]);
				if (isNaN(nStart)) return Command.errStartNum(line, tokens[0]);
				if (nStart < 0) return Command.errStartNeg(line, tokens[0]);
				if (!d20plus.anim.VALID_PROP_TOKEN.has(tokens[1])) return Command.errPropToken(line, "prop", tokens[1]);
				let prop = "";
				if (tokens.length > 2) prop = tokens.slice(2, tokens.length).join(" "); // combine trailing tokens
				try { prop = JSON.parse(prop); } catch (ignored) { console.warn(`Failed to parse "${prop}" as JSON, treating as raw string...`) }

				return new Command(
					line,
					null,
					d20plus.anim.SetProperty.bind(null, nStart, tokens[1], prop)
				);
			}

			case "macro": {
				if (tokens.length !== 2) return Command.errInvalidArgCount(line, 2);
				const nStart = Number(tokens[0]);
				if (isNaN(nStart)) return Command.errStartNum(line, tokens[0]);
				if (nStart < 0) return Command.errStartNeg(line, tokens[0]);
				// no validation for macro -- it might exist in the future if it doesn't now, or vice-versa

				return new Command(
					line,
					null,
					d20plus.anim.TriggerMacro.bind(null, nStart, tokens[1])
				);
			}

			case "anim": {
				if (tokens.length !== 2) return Command.errInvalidArgCount(line, 2);
				const nStart = Number(tokens[0]);
				if (isNaN(nStart)) return Command.errStartNum(line, tokens[0]);
				if (nStart < 0) return Command.errStartNeg(line, tokens[0]);
				const anim = d20plus.anim.animatorTool.getAnimations().find(it => it.name === tokens[1]);
				if (!anim) return new Command(line, `Could not find animation "${tokens[1]}"`, tokens[1]);

				return new Command(
					line,
					null,
					d20plus.anim.TriggerAnimation.bind(null, nStart, anim.uid)
				);
			}
		}
	};

	d20plus.anim.animatorTool = {
		name: "Token Animator",
		desc: "Manage token animations",
		html: `
			<div id="d20plus-token-animator" title="Token Animator" class="anm__win">
				<div class="split mb-2">
					<div>
						<button class="btn" name="btn-scenes">Edit Scenes</button>
						<button class="btn" name="btn-disable">Stop Animations</button>
						<button class="btn" name="btn-rescue">Rescue Tokens</button>
					</div>
					<div>
						<button class="btn" name="btn-saving" title="If enabled, can have a serious performance impact. If disabled, animations will not resume when reloading the game.">Save Active Animations</button>
					</div>
				</div>
				<div class="split mb-2">
					<button class="btn" name="btn-add">Add Animation</button>
					<button class="btn mr-2" name="btn-import">Import Animation</button>
				</div>
				
				<div class="anm__wrp-sel-all">
					<label class="flex-label"><input type="checkbox" title="Select all" name="cb-all" class="mr-2"> <span>Select All</span></label>
					<div>
						<button class="btn" name="btn-export">Export Selected</button>
						<button class="btn btn-danger" name="btn-delete">Delete Selected</button>
					</div>
				</div>
				
				<div id="token-animator-list-container">
					<input class="search" autocomplete="off" placeholder="Search list..." style="width: 100%;">
					<br><br>
					<ul class="list" style="max-height: 420px; overflow-y: auto; display: block; margin: 0;"></ul>
				</div>
			</div>
			
			<div id="d20plus-token-animator-disable" title="Stop Animation" class="anm__win">
				<p>
					<button class="btn" name="btn-refresh">Refresh</button>
				</p>
				
				<p class="anm__wrp-sel-all">
					<label class="flex-label"><input type="checkbox" title="Select all" name="cb-all" class="mr-2"> <span>Select All</span></label> 
					<button class="btn" name="btn-stop">Stop Selected</button>
				</p>
				
				<div id="token-animator-disable-list-container">
					<input class="search" autocomplete="off" placeholder="Search list..." style="width: 100%;">
					<div class="bold flex-v-center mt-2">
						<div class="col-1"></div>
						<div class="col-3 text-center">Page</div>
						<div class="col-2 text-center">Image</div>
						<div class="col-3 text-center">Name</div>
						<div class="col-3 text-center">Animation</div>
					</div>
					<ul class="list" style="max-height: 420px; overflow-y: auto; display: block; margin: 0;"></ul>
				</div>
			</div>
			
			<div id="d20plus-token-animator-rescue" title="Token Rescue" class="anm__win">
				<p>
					<button class="btn mr-2" name="btn-refresh">Refresh</button>
				</p>
				
				<p class="anm__wrp-sel-all">
					<label class="flex-label"><input type="checkbox" title="Select all" name="cb-all" class="mr-2"> <span>Select All</span></label> 
					<button class="btn" name="btn-rescue">Rescue Selected</button>
				</p>
				
				<div id="token-animator-rescue-list-container">
					<input class="search" autocomplete="off" placeholder="Search list..." style="width: 100%;">
					<div class="bold flex-v-center mt-2">
						<div class="col-1"></div>
						<div class="col-4 text-center">Page</div>
						<div class="col-2 text-center">Image</div>
						<div class="col-5 text-center">Name</div>
					</div>
					<ul class="list" style="max-height: 420px; overflow-y: auto; display: block; margin: 0;"></ul>
				</div>
			</div>
			
			<div id="d20plus-token-animator-scene" title="Scene List" class="anm__win">
				<div class="split mb-2">
					<button class="btn" name="btn-add">Add Scene</button>
					<button class="btn mr-2" name="btn-import">Import Scene</button>
				</div>
				
				<div class="anm__wrp-sel-all">
					<label class="flex-label"><input type="checkbox" title="Select all" name="cb-all" class="mr-2"> <span>Select All</span></label>
					<div>
						<button class="btn" name="btn-export">Export Selected</button>
						<button class="btn btn-danger" name="btn-delete">Delete Selected</button>
					</div>
				</div>
				
				<div id="token-animator-scene-list-container">
					<input class="search" autocomplete="off" placeholder="Search list..." style="width: 100%;">
					<br><br>
					<ul class="list" style="max-height: 420px; overflow-y: auto; display: block; margin: 0;"></ul>
				</div>
			</div>
		`,
		_html_template_editor: `
			<div title="Animation Editor" class="anm__win flex-col">
				<div class="mb-2 no-shrink split">
					<input name="ipt-name" placeholder="Name">
					
					<div>
						<button class="btn" name="btn-save">Save</button>
						<button class="btn" name="btn-help">View Help</button>
						<button class="btn" name="btn-export-file">Export to File</button>
						<button class="btn" name="btn-validate">Validate</button>
					</div>
				</div>
				<div class="anm-edit__ipt-lines-wrp">
					<textarea name="ipt-lines" placeholder="mv 0 100 50 -50" class="anm-edit__ipt-lines"></textarea>
				</div>
			</div>
		`,
		_html_template_scene_editor: `
			<div title="Scene Editor" class="anm__win flex-col">
				<div class="mb-2 no-shrink split">
					<input name="ipt-name" placeholder="Name">
					
					<div>
						<button class="btn" name="btn-save">Save</button>
						<button class="btn" name="btn-export-file">Export to File</button>
					</div>
				</div>
				<div class="mb-2">
					<button class="btn" name="btn-add">Add Part</button>
				</div>
				<div class="bold flex-v-center mt-2">
					<div class="col-3 text-center">Token</div>
					<div class="col-2"></div>
					<div class="col-2 text-center">Animation</div>
					<div class="col-2"></div>
					<div class="col-2 text-center help" title="Delay period upon starting the scene before this animation is run (in milliseconds)">Start Time</div>
					<div class="col-1"></div>
				</div>
				<div class="anm-edit__ipt-rows-wrp">
					
				</div>
			</div>
		`,

		dialogFn () {
			$("#d20plus-token-animator").dialog({
				autoOpen: false,
				resizable: true,
				width: 800,
				height: 600,
			}).data("initialised", false);

			$("#d20plus-token-animator-disable").dialog({
				autoOpen: false,
				resizable: true,
				width: 800,
				height: 600,
			});

			$("#d20plus-token-animator-rescue").dialog({
				autoOpen: false,
				resizable: true,
				width: 800,
				height: 600,
			});

			$("#d20plus-token-animator-scene").dialog({
				autoOpen: false,
				resizable: true,
				width: 800,
				height: 600,
			});

			// FIXME temp code; remove
			window.addEventListener("keypress", (evt) => {
				if (evt.shiftKey && !evt.ctrlKey) {
					if (evt.key === "G") this.openFn();
				}
			})
		},

		openFn () {
			this.init();
			this.$win.dialog("open");
		},

		// region public
		init () {
			this.$win = this.$win || $("#d20plus-token-animator");
			if (!this.$win.data("initialised")) {
				this._meta_init();
				// init the runner after, as we need to first load the animations
				d20plus.anim.animator.init();
			}
		},

		getAnimation (uid) {
			return this._anims[uid];
		},

		getAnimQueue (anim, additionalOffset) {
			additionalOffset = additionalOffset || 0;
			this._edit_convertLines(anim);
			const queue = anim.lines.filter(it => it.isRunnable).map(it => it.getInstance());
			queue.forEach(it => it._offset += additionalOffset);
			return queue;
		},

		_getUidItems (fromObj) {
			return Object.entries(fromObj).map(([k, v]) => ({
				uid: k,
				name: v.name
			}))
		},

		getAnimations () {
			return this._getUidItems(this._anims);
		},

		getScenes () {
			return this._getUidItems(this._scenes);
		},

		isSavingActive () {
			return !!this._isSaveActive;
		},

		_pSelectUid (fnGetAll, msgNoneFound, title, defaultSelUid) {
			// convert, as the UIDs are object keys
			if (defaultSelUid != null) defaultSelUid = String(defaultSelUid);

			const selFrom = fnGetAll();
			if (!selFrom.length) return d20plus.ut.chatLog(msgNoneFound);

			return new Promise(resolve => {
				const $selUid = $(`<select>
				<option disabled value="-1">${title}</option>
				${selFrom.map(it => `<option value="${it.uid}">${it.name}</option>`)}
				</select>`);
				if (defaultSelUid != null && selFrom.find(it => it.uid === defaultSelUid)) $selUid.val(defaultSelUid);
				else $selUid[0].selectedIndex = 0;

				const $dialog = $$`
					<div title="${title}">
						${$selUid}
					</div>
				`.appendTo($("body"));

				$dialog.dialog({
					dialogClass: "no-close",
					buttons: [
						{
							text: "Cancel",
							click: function () {
								$(this).dialog("close");
								$dialog.remove();
							}
						},
						{
							text: "OK",
							click: function () {
								const selected = Number($selUid.val());
								$(this).dialog("close");
								$dialog.remove();

								if (~selected) resolve(selected);
								else resolve(null);
							}
						}
					]
				});
			});
		},

		pSelectAnimation (defaultSelUid) {
			return this._pSelectUid(
				this.getAnimations.bind(this),
				"No animations available! Use the Token Animator tool to define some first.",
				"Select Animation",
				defaultSelUid
			);
		},

		pSelectScene (defaultSelUid) {
			return this._pSelectUid(
				this.getScenes.bind(this),
				"No scenes available! Use Edit Scenes in the Token Animator tool to define some first.",
				"Select Scene",
				defaultSelUid
			);
		},

		doStartScene (sceneUid) {
			const scene = this._scenes[sceneUid];
			if (!scene) return d20plus.ut.chatLog(`Could not find scene!`);

			(scene.anims || []).forEach(animMeta => {
				if (animMeta.tokenId && animMeta.animUid) {
					const token = d20plus.ut.getTokenById(animMeta.tokenId);
					if (!token) return;
					const anim = this.getAnimation(animMeta.animUid);
					if (!anim) return;
					d20plus.anim.animator.startAnimation(token, animMeta.animUid, {offset: animMeta.offset || 0});
				}
			});
		},
		// endregion public

		// region meta
		_meta_doSaveState () {
			// copy, and return any parsed commands to strings
			const saveableAnims = {};
			Object.entries(this._anims).forEach(([k, v]) => {
				saveableAnims[k] = {
					...v,
					lines: [...(v.lines || [])].map(it => typeof it === "string" ? it : it.line)
				}
			});

			Campaign.save({
				bR20tool__anim_id: this._anim_id,
				bR20tool__anim_animations: saveableAnims,
				bR20tool__anim_save: this._isSaveActive,
				bR20tool__anim_scene_id: this._scene_id,
				bR20tool__anim_scenes: this._scenes,
			});
		},

		_meta_doLoadState () {
			this._anim_id = Campaign.attributes.bR20tool__anim_id || 1;
			this._scene_id = Campaign.attributes.bR20tool__anim_scene_id || 1;

			// convert legacy "array" version to object
			this._anims = {};
			if (Campaign.attributes.bR20tool__anim_animations) {
				const loadedAnims = MiscUtil.copy(Campaign.attributes.bR20tool__anim_animations);
				this._anims = {};
				Object.entries(loadedAnims).filter(([k, v]) => !!v).forEach(([k, v]) => this._anims[k] = v);
			}

			this._scenes = Campaign.attributes.bR20tool__anim_scenes ? MiscUtil.copy(Campaign.attributes.bR20tool__anim_scenes) : {};

			this._isSaveActive = MiscUtil.copy(Campaign.attributes.bR20tool__anim_save) || false;
		},

		_meta_init () {
			this._meta_doLoadState();
			this._doSaveStateDebounced = MiscUtil.debounce(this._meta_doSaveState, 100);

			this._$winScene = $(`#d20plus-token-animator-scene`);
			this._$winDisable = $(`#d20plus-token-animator-disable`);
			this._$winRescue = $(`#d20plus-token-animator-rescue`);

			this._main_init();
			this._scene_init();
			this._rescue_init();
			this._dis_init();
			this.$win.data("initialised", true);
		},
		// endregion meta

		// region shared
		async _shared_doImport (prop, name, fnNextId, fnNextName, fnGetValidMsg, fnAdd, ...requiredProps) {
			let data;
			try {
				data = await DataUtil.pUserUpload();
			} catch (e) {
				d20plus.ut.chatLog("File was not valid JSON!");
				console.error(e);
				return;
			}

			if (data[prop] && data[prop].length) {
				let messages = [];
				data[prop].forEach((it, i) => {
					const missingProp = requiredProps.find(rp => it[rp] == null);
					if (missingProp != null) messages.push(`${name.uppercaseFirst()} at index ${i} is missing required fields!`);
					else {
						const originalName = it.name;
						it.uid = fnNextId();
						it.name = fnNextName(it.name);
						const msg = fnGetValidMsg(it);
						if (msg) {
							messages.push(`${originalName} was invalid: ${msg}`);
						} else {
							fnAdd(it);
							messages.push(`Added ${originalName}${it.name !== originalName ? ` (renamed as ${it.name})` : ""}!`);
						}
					}
				});

				if (messages.length) {
					console.log(messages.join("\n"));
					return d20plus.ut.chatLog(messages.join("\n"))
				}
			} else {
				return d20plus.ut.chatLog(`File contained no ${name}s!`);
			}
		},

		_shared_getValidNameMsg (obj, peers) {
			if (!obj.name.length) return "Did not have a name!";
			const illegalNameChars = obj.name.split(/[_0-9a-zA-Z]/g).filter(Boolean);
			if (illegalNameChars.length) return `Illegal characters in name: ${illegalNameChars.map(it => `"${it}"`).join(", ")}`;
			const sameName = Object.values(peers).filter(it => it.uid !== obj.uid).find(it => it.name === obj.name);
			if (sameName) return "Name must be unique!";
		},

		_shared_getNextName (obj, baseName) {
			let nxtName = baseName;
			let suffix = 1;
			while (Object.values(obj).find(it => it.name === nxtName)) nxtName = `${baseName}_${suffix++}`;
			return nxtName;
		},
		// endregion

		// region main
		_main_init () {
			const $btnAdd = this.$win.find(`[name="btn-add"]`);
			const $btnImport = this.$win.find(`[name="btn-import"]`);
			const $btnDisable = this.$win.find(`[name="btn-disable"]`);
			const $btnScenes = this.$win.find(`[name="btn-scenes"]`);
			const $btnRescue = this.$win.find(`[name="btn-rescue"]`);
			const $btnToggleSave = this.$win.find(`[name="btn-saving"]`);

			const $btnSelExport = this.$win.find(`[name="btn-export"]`);
			const $btnSelDelete = this.$win.find(`[name="btn-delete"]`);

			const $cbAll = this.$win.find(`[name="cb-all"]`);
			this._$list = this.$win.find(`.list`);

			$btnAdd.click(() => this._main_addAnim(this._main_getNewAnim()));

			$btnImport.click(async () => {
				await this._shared_doImport(
					"animations",
					"animation",
					this._main_getNextId.bind(this),
					this._shared_getNextName.bind(this, this._anims),
					this._edit_getValidationMessage.bind(this),
					this._main_addAnim.bind(this),
					"uid", "name", "lines" // required properties
				);
			});

			$btnScenes.click(() => {
				this._scene_doPopulateList();
				this._$winScene.dialog("open");
			});

			$btnDisable.click(() => {
				this._dis_doPopulateList();
				this._$winDisable.dialog("open");
			});

			$btnRescue.click(() => {
				this._rescue_doPopulateList();
				this._$winRescue.dialog("open")
			});

			$btnToggleSave.toggleClass("active", this._isSaveActive);
			$btnToggleSave.click(() => {
				this._isSaveActive = !this._isSaveActive;
				$btnToggleSave.toggleClass("active", this._isSaveActive);
				this._doSaveStateDebounced();

				// on disable, clear existing running animations
				// prevents next load from re-loading old running state
				if (!this._isSaveActive) {
					Campaign.save({bR20tool__anim_running: {}});
				}
			});

			const getSelButtons = ofClass => {
				return this._anim_list.items
					.map(it => $(it.elm))
					.filter($it => $it.find(`input`).prop("checked"))
					.map($it => $it.find(`.${ofClass}`));
			};

			$btnSelExport.click(() => {
				const out = {
					animations: this._anim_list.items
						.filter(it => $(it.elm).find(`input`).prop("checked"))
						.map(it => this._main_getExportableAnim(this._anims[it.values().uid]))
				};
				DataUtil.userDownload("animations", out);
			});

			$cbAll.click(() => {
				const val = $cbAll.prop("checked");
				this._anim_list.items.forEach(it => {
					$(it.elm.children[0].children[0]).prop("checked", val);
				})
			});

			$btnSelDelete.click(() => {
				const $btns = getSelButtons(`.anm__btn-delete`);
				if (!$btns.length) return;
				if (!confirm("Are you sure?")) return;
				$btns.forEach($btn => $btn.click());
			});

			this._main_doPopulateList();
		},

		_main_getExportableAnim (anim) {
			const out = {...anim};
			out.lines = out.lines.map(it => typeof it === "string" ? it : it.line);
			return out;
		},

		_main_doPopulateList () {
			this._$list.empty();
			Object.values(this._anims).forEach(anim => this._$list.append(this._main_getListItem(anim)));

			this._anim_list = new List("token-animator-list-container", {
				valueNames: ["name", "uid"]
			});
		},

		_main_addAnim (anim) {
			const lastSearch = ListUtil.getSearchTermAndReset(this._anim_list);
			this._anims[anim.uid] = anim;
			this._$list.append(this._main_getListItem(anim));

			this._anim_list.reIndex();
			if (lastSearch) this._anim_list.search(lastSearch);
			this._anim_list.sort("name");

			this._doSaveStateDebounced();
		},

		_main_getNewAnim () {
			return {
				uid: this._main_getNextId(),
				name: this._shared_getNextName(this._anims, "new_animation"),
				lines: []
			}
		},

		_main_getNextId () {
			return this._anim_id++;
		},

		_main_getListItem (anim) {
			const $name = $(`<div class="name readable col-9 clickable" title="Edit Animation">${anim.name}</div>`)
				.click(() => this._edit_openEditor(anim));

			const $btnDuplicate = $(`<div class="btn anm__row-btn pictos mr-2" title="Duplicate">F</div>`)
				.click(() => {
					const copy = MiscUtil.copy(anim);
					copy.name = `${copy.name}_copy`;
					copy.uid = this._anim_id++;
					this._main_addAnim(copy);
				});

			const $btnExport = $(`<div class="btn anm__row-btn pictos mr-2" title="Export to File">I</div>`)
				.click(() => {
					const out = {animations: [this._main_getExportableAnim(anim)]};
					DataUtil.userDownload(`${anim.name}`, out);
				});

			const $btnDelete = $(`<div class="btn anm__row-btn btn-danger pictos anm__btn-delete mr-2" title="Delete">#</div>`)
				.click(() => {
					delete this._anims[anim.uid];
					this._anim_list.remove("uid", anim.uid);
					this._doSaveStateDebounced();
				});

			return $$`<div class="anm__row">
				<label class="col-1 flex-vh-center full-height"><input type="checkbox"></label>
				${$name}
				<div class="anm__row-controls col-2 text-center">
					${$btnDuplicate}
					${$btnExport}
					${$btnDelete}
				</div>
				<div class="hidden uid">${anim.uid}</div>
			</div>`;
		},
		// endregion main

		// region scene
		_scene_getSelected () {
			return this._scene_list.items.filter(it => $(it.elm).find("input[type=checkbox]").prop("checked"));
		},

		_scene_addScene (scene) {
			const lastSearch = ListUtil.getSearchTermAndReset(this._scene_list);
			this._scenes[scene.uid] = scene;
			this._scene_$wrpList.append(this._scene_$getListItem(scene));

			this._scene_list.reIndex();
			if (lastSearch) this._scene_list.search(lastSearch);
			this._scene_list.sort("name");

			this._doSaveStateDebounced();
		},

		_scene_$getListItem (scene) {
			const $name = $(`<div class="name readable col-9 clickable" title="Edit Animation">${scene.name}</div>`)
				.click(() => this._scene_openEditor(scene));

			const $btnDuplicate = $(`<div class="btn anm__row-btn pictos mr-2" title="Duplicate">F</div>`)
				.click(() => {
					const copy = MiscUtil.copy(scene);
					copy.name = `${copy.name}_copy`;
					copy.uid = this._scene_id++;
					this._scene_addScene(copy);
				});

			const $btnExport = $(`<div class="btn anm__row-btn pictos mr-2" title="Export to File">I</div>`)
				.click(() => {
					const out = {scenes: [scene]};
					DataUtil.userDownload(`${scene.name}`, out);
				});

			const $btnDelete = $(`<div class="btn anm__row-btn btn-danger pictos anm__btn-delete mr-2" title="Delete">#</div>`)
				.click(() => {
					delete this._scenes[scene.uid];
					this._scene_list.remove("uid", scene.uid);
					this._doSaveStateDebounced();
				});

			return $$`<div class="flex-v-center mb-2">
				<label class="col-1 flex-vh-center full-height"><input type="checkbox"></label>
				${$name}
				<div class="anm__row-controls col-2 text-center">
					${$btnDuplicate}
					${$btnExport}
					${$btnDelete}
				</div>
				<div class="uid hidden">${scene.uid}</div>
			</div>`
		},

		_scene_doPopulateList () {
			this._scene_$wrpList.empty();
			Object.values(this._scenes).forEach(scene => this._scene_$wrpList.append(this._scene_$getListItem(scene)));

			this._scene_list = new List("token-animator-scene-list-container", {
				valueNames: [
					"name",
					"uid"
				]
			});
		},

		_scene_init () {
			this._scene_$btnAdd = this._$winScene.find(`[name="btn-add"]`);
			this._scene_$btnImport = this._$winScene.find(`[name="btn-import"]`);
			this._scene_$btnExport = this._$winScene.find(`[name="btn-export"]`);
			this._scene_$btnDelete = this._$winScene.find(`[name="btn-delete"]`);
			this._scene_$cbAll = this._$winScene.find(`[name="cb-all"]`);
			this._scene_$wrpList = this._$winScene.find(`.list`);

			this._scene_list = null;

			this._scene_$cbAll.click(() => {
				const toVal = this._scene_$cbAll.prop("checked");
				this._scene_list.items.forEach(it => $(it.elm).find("input[type=checkbox]").prop("checked", toVal));
			});

			this._scene_$btnAdd.off("click").click(() => this._scene_addScene(this._scene_getNewScene()));

			this._scene_$btnImport.click(async () => {
				await this._shared_doImport(
					"scenes",
					"scene",
					this._scene_getNextId.bind(this),
					this._shared_getNextName.bind(this, this._scenes),
					this._scene_getValidationMessage.bind(this),
					this._scene_addScene.bind(this),
					"uid", "name", "anims" // required properties
				);
			});

			this._scene_$btnExport.click(() => {
				const out = {
					scenes: this._scene_getSelected()
						.map(it => this._scenes[it.values().uid])
				};
				DataUtil.userDownload("scenes", out);
			});

			this._scene_$btnDelete.click(() => {
				const sel = this._scene_getSelected();
				if (!sel.length) return;
				if (!confirm("Are you sure?")) return;
				sel.forEach(it => {
					const uid = it.values()._scene_id;
					delete this._scenes[uid];
					this._scene_list.remove("uid", uid);
				});
				this._doSaveStateDebounced();
			});
		},

		_scene_getNextId () {
			return this._scene_id++;
		},

		_scene_getNewScene () {
			return {
				uid: this._scene_getNextId(),
				name: this._shared_getNextName(this._scenes, "new_scene"),
				anims: []
				/*
				Anims array structure:
				[
					...,
					{
						tokenId: "",
						animUid: "",
						offset: 0
					},
					...
				]
				 */
			}
		},

		_scene_openEditor (scene) {
			scene = MiscUtil.copy(scene);
			scene.anims = scene.anims || []; // handle legacy data
			const editorOptions = {};

			const $winEditor = $(this._html_template_scene_editor).appendTo($("body"));

			const $iptName = $winEditor.find(`[name="ipt-name"]`).disableSpellcheck()
				.val(scene.name)
				.change(() => scene.name = $iptName.val().trim());
			const $btnSave = $winEditor.find(`[name="btn-save"]`);
			const $btnExportFile = $winEditor.find(`[name="btn-export-file"]`);
			const $btnAdd = $winEditor.find(`[name="btn-add"]`);
			const $wrpRows = $winEditor.find(`.anm-edit__ipt-rows-wrp`);

			$btnSave.off("click").click(() => {
				const msg = this._scene_getValidationMessage(scene);
				if (msg) return d20plus.ut.chatLog(msg);

				// we passed validation
				this._scenes[scene.uid] = scene;

				this._doSaveStateDebounced();

				const matches = this._scene_list.get("uid", scene.uid);
				if (matches.length) {
					matches[0].values({name: scene.name})
				}

				d20plus.ut.chatLog("Saved!");
			});

			$btnExportFile.off("click").click(() => {
				const out = {scenes: [scene]};
				DataUtil.userDownload(`${scene.name}`, out);
			});

			$btnAdd.off("click").click(() => $wrpRows.append(this._scene_$getEditorRow(editorOptions, scene)));

			$wrpRows.empty();
			scene.anims.forEach(animMeta => $wrpRows.append(this._scene_$getEditorRow(editorOptions, scene, animMeta)));

			$winEditor.dialog({
				resizable: true,
				width: 800,
				height: 600,
				close: () => {
					setTimeout(() => $winEditor.remove())
				}
			});
		},

		_scene_$getEditorRow (editorOptions, scene, animMeta) {
			if (!animMeta) {
				animMeta = {
					offset: 0
				};
				scene.anims.push(animMeta);
			}

			const $btnSelToken = $(`<button class="btn anm__row-btn">Select Token</button>`)
				.click(() => {
					let lastSelectedTokenId = null;

					const $selPage = $(`<select><option disabled value="">Select Page</option></select>`)
						.change(() => {
							lastSelectedTokenId = null;
							$wrpTokens.empty();

							const page = d20.Campaign.pages.get($selPage.val());
							editorOptions.lastPageId = $selPage.val();

							if (page.thegraphics && page.thegraphics.length) {
								const tokens = page.thegraphics.models.filter(it => it.attributes.type === "image");
								tokens.forEach(it => {
									const name = it.attributes.name || "(Unnamed)";
									const $wrpToken = $$`<div class="anm-scene__wrp-token">
											<div class="no-shrink flex-vh-center" style="width: 80px; height: 80px;">
												<img 
													class="no-shrink" 
													style="max-width: 80px; max-height: 80px;" 
													src="${it.attributes.imgsrc}"
												>
											</div>
											<div class="no-shrink full-width flex-vh-center anm-scene__wrp-token-name">
												<span title="${name}" class="anm-scene__wrp-token-name-inner">${name}</span>
											</div>
										</div>`.click(() => {
										$wrpTokens.find(`.anm-scene__wrp-token`).removeClass(`anm-scene__wrp-token--active`);
										$wrpToken.addClass(`anm-scene__wrp-token--active`);
										lastSelectedTokenId = it.id;
									}).appendTo($wrpTokens);
								});
							} else $wrpTokens.append("There are no tokens on this page!");
						});
					d20.Campaign.pages.forEach(it => $(`<option value="${it.id}"></option>`).text(it.attributes.name || "(Unnamed)").appendTo($selPage));
					// default re-display last page
					if (editorOptions.lastPageId && d20.Campaign.pages.get(editorOptions.lastPageId)) $selPage.val(editorOptions.lastPageId);
					else $selPage[0].selectedIndex = 0;

					const $wrpTokens = $$`<div class="anm-scene__wrp-tokens"></div>`;

					const $dialog = $$`
							<div title="Select Token">
								<div class="flex-col full-width full-height">
									<div class="mb-2 no-shrink">${$selPage}</div>
									${$wrpTokens}
								</div>
							</div>
						`.appendTo($("body"));

					$dialog.dialog({
						dialogClass: "no-close",
						buttons: [
							{
								text: "Cancel",
								click: function () {
									$(this).dialog("close");
									$dialog.remove();
								}
							},
							{
								text: "OK",
								click: function () {
									$(this).dialog("close");
									$dialog.remove();

									if (lastSelectedTokenId != null) {
										animMeta.tokenId = lastSelectedTokenId;
										$wrpToken.html(getTokenPart());
										$wrpTokenName.html(getTokenNamePart());
									}
								}
							}
						],
						width: 640,
						height: 480
					});
				});
			const getTokenPart = () => {
				const token = animMeta.tokenId ? d20plus.ut.getTokenById(animMeta.tokenId) : null;
				return token ? `<img src="${token.attributes.imgsrc}" style="max-width: 40px; max-height: 40px;">` : "";
			};
			const getTokenNamePart = () => {
				const token = animMeta.tokenId ? d20plus.ut.getTokenById(animMeta.tokenId) : null;
				return token ? token.attributes.name : "";
			};
			const $wrpToken = $(`<div>${getTokenPart()}</div>`);
			const $wrpTokenName = $(`<div>${getTokenNamePart()}</div>`);

			const $btnSelAnim = $(`<button class="btn anm__row-btn">Select Animation</button>`)
				.click(async () => {
					const anim = await this.pSelectAnimation(editorOptions.lastAnimUid);
					if (anim != null) {
						editorOptions.lastAnimUid = anim;
						animMeta.animUid = anim;
						$wrpAnim.html(getAnimPart())
					}
				});
			const getAnimPart = () => {
				const anim = animMeta.animUid ? this.getAnimation(animMeta.animUid) : null;
				return anim ? anim.name : "";
			};
			const $wrpAnim = $(`<div>${getAnimPart()}</div>`);

			const $iptOffset = $(`<input type="number" min="0" style="max-width: 100%;" class="text-right">`)
				.val(animMeta.offset || 0)
				.change(() => {
					const rawNum = Number($iptOffset.val());
					const num = isNaN(rawNum) ? 0 : rawNum;
					animMeta.offset = Math.max(0, num);
					$iptOffset.val(animMeta.offset);
				});

			const $btnDelete = $(`<button class="btn btn-danger anm__row-btn pictos">#</button>`)
				.click(() => {
					scene.anims.splice(scene.anims.indexOf(animMeta), 1);
					$out.remove();
				});

			const $out = $$`<div class="flex-vh-center mb-1">
					<div class="col-1 text-center">${$wrpToken}</div>
					<div class="col-2 text-center">${$wrpTokenName}</div>
					<div class="col-2 text-center">${$btnSelToken}</div>
					
					<div class="col-2 text-center">${$wrpAnim}</div>
					<div class="col-2 text-center">${$btnSelAnim}</div>
					
					<div class="col-2">${$iptOffset}</div>
					
					<div class="col-1 text-center">${$btnDelete}</div>
				</div>`;
			return $out;
		},

		_scene_getValidationMessage (scene) {
			// validate name
			return this._shared_getValidNameMsg(scene, this._scenes);
		},
		// endregion

		// region rescue
		_rescue_getSelected () {
			return this._rescue_list.items.filter(it => $(it.elm).find("input[type=checkbox]").prop("checked"));
		},

		_rescue_getListItem (page, imgUrl, tokenName, _tokenId) {
			return `<label class="flex-v-center">
				<div class="col-1 flex-vh-center full-height"><input type="checkbox"></div>
				<div class="page col-4">${page}</div>				
				<div class="col-2">
					<a href="${imgUrl}" target="_blank"><img src="${imgUrl}" style="max-width: 40px; max-height: 40px;"></a>
				</div>				
				<div class="col-5 tokenName">${tokenName || "(unnamed)"}</div>
				<div class="_tokenId hidden">${_tokenId}</div>		
			</label>`
		},

		_rescue_doPopulateList () {
			let temp = "";

			const pageW = d20.Campaign.activePage().attributes.width * 70;
			const pageH = d20.Campaign.activePage().attributes.height * 70;

			const outOfBounds = d20.Campaign.activePage().thegraphics.models.filter(tokenModel => {
				return tokenModel.view.graphic.scaleX < 0.01 ||
					tokenModel.view.graphic.scaleX > 50.0 ||
					tokenModel.view.graphic.scaleY < 0.01 ||
					tokenModel.view.graphic.scaleY > 50.0 ||
					tokenModel.attributes.left < 0 ||
					tokenModel.attributes.left > pageW ||
					tokenModel.attributes.top < 0 ||
					tokenModel.attributes.top > pageH;
			});

			outOfBounds.forEach(token => {
				const pageId = token.attributes.page_id;
				const pageName = (d20.Campaign.pages.get(pageId) || {attributes: {name: "(unknown)"}}).attributes.name;

				temp += this._rescue_getListItem(
					pageName,
					token.attributes.imgsrc,
					token.attributes.name,
					token.attributes.id,
				)
			});

			this._rescue_$wrpList.empty().append(temp);

			this._rescue_list = new List("token-animator-rescue-list-container", {
				valueNames: [
					"page",
					"tokenName",
					"_tokenId",
				]
			});
		},

		_rescue_init () {
			this._rescue_$btnRefresh = this._$winRescue.find(`[name="btn-refresh"]`);
			this._rescue_$btnRescue = this._$winRescue.find(`[name="btn-rescue"]`);
			this._rescue_$cbAll = this._$winRescue.find(`[name="cb-all"]`);
			this._rescue_$wrpList = this._$winRescue.find(`.list`);

			this._rescue_list = null;

			this._rescue_$cbAll.click(() => {
				const toVal = this._rescue_$cbAll.prop("checked");
				this._rescue_list.items.forEach(it => $(it.elm).find("input[type=checkbox]").prop("checked", toVal));
			});

			this._rescue_$btnRefresh.click(() => this._rescue_doPopulateList());

			this._rescue_$btnRescue.off("click").click(() => {
				const sel = this._rescue_getSelected();
				if (!sel.length) return d20plus.ut.chatLog("Please select some items from the list!");

				sel.map(it => it.values()).forEach(it => {
					// disable animations for token
					delete d20plus.anim.animator._tracker[it._tokenId];

					// reset token properties; place in the top-left corner of the canvas on the GM layer
					const token = d20plus.ut.getTokenById(it._tokenId);
					token.attributes.scaleX = 1.0;
					token.view.graphic.scaleX = token.attributes.scaleX;
					token.attributes.scaleY = 1.0;
					token.view.graphic.scaleY = token.attributes.scaleY;
					token.attributes.flipv = false;
					token.attributes.fliph = false;
					token.attributes.left = 35;
					token.attributes.top = 35;
					token.attributes.width = 70;
					token.attributes.height = 70;
					token.attributes.rotation = 0;
					token.attributes.layer = "gmlayer";
					token.save();
				});

				d20plus.ut.chatLog("Rescued tokens will be placed on the GM layer, in the top-left corner of the map");
				this._rescue_doPopulateList();
			});
		},
		// endregion rescue

		// region disabler
		_dis_getSelected () {
			return this._dis_list.items.filter(it => $(it.elm).find("input[type=checkbox]").prop("checked"));
		},

		_dis_getListItem (page, imgUrl, tokenName, animName, _tokenId, _animUid) {
			return `<label class="flex-v-center">
				<div class="col-1 flex-vh-center full-height"><input type="checkbox"></div>
				<div class="page col-3">${page}</div>				
				<div class="col-2">
					<a href="${imgUrl}" target="_blank"><img src="${imgUrl}" style="max-width: 40px; max-height: 40px;"></a>
				</div>				
				<div class="col-3 tokenName">${tokenName || "(unnamed)"}</div>				
				<div class="col-3 animName">${animName}</div>
				<div class="_tokenId hidden">${_tokenId}</div>				
				<div class="_animUid hidden">${_animUid}</div>				
			</label>`
		},

		_dis_doPopulateList () {
			let temp = "";

			Object.entries(d20plus.anim.animator._tracker).forEach(([tokenId, tokenMeta]) => {
				const imgUrl = tokenMeta.token.attributes.imgsrc;
				const pageId = tokenMeta.token.attributes.page_id;
				const pageName = (d20.Campaign.pages.get(pageId) || {attributes: {name: "(unknown)"}}).attributes.name;

				Object.entries(tokenMeta.active).forEach(([animUid, animMeta]) => {
					temp += this._dis_getListItem(
						pageName,
						imgUrl,
						tokenMeta.token.attributes.name,
						d20plus.anim.animatorTool.getAnimation(animUid).name,
						tokenId,
						animUid
					)
				});
			});

			this._dis_$wrpList.empty().append(temp);

			this._dis_list = new List("token-animator-disable-list-container", {
				valueNames: [
					"page",
					"tokenName",
					"animName",
					"_tokenId",
					"_animUid"
				]
			});
		},

		_dis_init () {
			this._dis_$btnRefresh = this._$winDisable.find(`[name="btn-refresh"]`);
			this._dis_$btnStop = this._$winDisable.find(`[name="btn-stop"]`);
			this._dis_$cbAll = this._$winDisable.find(`[name="cb-all"]`);
			this._dis_$wrpList = this._$winDisable.find(`.list`);

			this._dis_list = null;

			this._dis_$cbAll.click(() => {
				const toVal = this._dis_$cbAll.prop("checked");
				this._dis_list.items.forEach(it => $(it.elm).find("input[type=checkbox]").prop("checked", toVal));
			});

			this._dis_$btnRefresh.click(() => this._dis_doPopulateList());

			this._dis_$btnStop.off("click").click(() => {
				const sel = this._dis_getSelected();
				if (!sel.length) return d20plus.ut.chatLog("Please select some items from the list!");
				if (!confirm("Are you sure?")) return;

				sel.map(it => it.values()).forEach(it => {
					delete d20plus.anim.animator._tracker[it._tokenId].active[it._animUid];

					if (!hasAnyKey(d20plus.anim.animator._tracker[it._tokenId].active)) {
						delete d20plus.anim.animator._tracker[it._tokenId];
					}
				});

				d20plus.anim.animator.saveState();
				this._dis_doPopulateList();
			});
		},
		// endregion disabler

		// region editor
		_edit_openEditor (anim) {
			const $winEditor = $(this._html_template_editor).appendTo($("body"));

			$winEditor.dialog({
				resizable: true,
				width: 800,
				height: 600,
				close: () => {
					setTimeout(() => $winEditor.remove())
				}
			});

			const $iptName = $winEditor.find(`[name="ipt-name"]`).disableSpellcheck();
			const $btnSave = $winEditor.find(`[name="btn-save"]`);
			const $btnHelp = $winEditor.find(`[name="btn-help"]`);
			const $btnExportFile = $winEditor.find(`[name="btn-export-file"]`);
			const $btnValidate = $winEditor.find(`[name="btn-validate"]`);
			const $iptLines = $winEditor.find(`[name="ipt-lines"]`);

			anim.lines = anim.lines || [];

			$iptName.val(anim.name);
			$iptLines.val(anim.lines.map(it => typeof it === "string" ? it : it.line).join("\n"));

			const getValidationMessage = () => {
				// create a fake animation object, and check it for errors
				const toValidate = {
					uid: anim.uid, // pass out UID, so the validator can ignore our old data when checking duplicate names
					name: $iptName.val(),
					lines: $iptLines.val().split("\n")
				};
				return this._edit_getValidationMessage(toValidate);
			};

			$btnSave.off("click").click(() => {
				const msg = getValidationMessage();
				if (msg) return d20plus.ut.chatLog(msg);

				// we passed validation
				anim.name = $iptName.val();
				anim.lines = $iptLines.val().split("\n");
				this._doSaveStateDebounced();

				const matches = this._anim_list.get("uid", anim.uid);
				if (matches.length) {
					matches[0].values({name: anim.name})
				}

				d20plus.ut.chatLog("Saved!");
			});

			$btnExportFile.off("click").click(() => {
				const out = {animations: [this._main_getExportableAnim(anim)]};
				DataUtil.userDownload(`${anim.name}`, out);
			});

			$btnValidate.off("click").click(() => {
				const msg = getValidationMessage();
				d20plus.ut.chatLog(msg || "Valid!");
			});

			$btnHelp.click(() => {
				// TODO link to a wiki page
				d20plus.ut.chatLog("Coming soon to a Wiki near you");
			});
		},

		/**
		 * Returns `null` if valid, or an error message if invalid.
		 * @private
		 */
		_edit_getValidationMessage (anim) {
			// validate name
			const nameMsg = this._shared_getValidNameMsg(anim, this._anims);
			if (nameMsg) return nameMsg;

			// validate lines
			this._edit_convertLines(anim);

			const badLines = anim.lines.filter(c => c.error);
			if (badLines.length) {
				return `Invalid, the following lines could not be parsed:\n${badLines.map(c => `${c.error} at line "${c.line}"`).join("\n")}`;
			}

			return null;
		},

		_edit_convertLines (anim) {
			anim.lines = anim.lines.map(l => typeof l === "string" ? Command.fromString(l) : l);
		},
		// endregion editor
	};

	d20plus.tool.tools.push(d20plus.anim.animatorTool);

	function hasAnyKey (object) {
		for (const k in object) {
			if (!object.hasOwnProperty(k)) continue;
			return true;
		}
		return false;
	}

	d20plus.anim.animator = {
	   /*
		_tracker: {
			tokenId: {
				token: {...}, // Roll20 token
				active: {
					// only one instance of an animation can be active on a token at a time
					animUid: {
						queue: [...], // returned by getAnimQueue
						start, // start time
						lastTick, // last tick time
						lastAlpha // last alpha value passed -- used for deserialization
					},
					... // other animations
				}
			}
		}
		*/
		_tracker: {},
		_restTicks: 1,

		__tickCount: 0,

		startAnimation (token, animUid, options) {
			options = options || {};

			const anim = d20plus.anim.animatorTool.getAnimation(animUid);
			const queue = d20plus.anim.animatorTool.getAnimQueue(anim, options.offset || 0);

			this._tracker[token.id] = this._tracker[token.id] || {token, active: {}};
			const time = (new Date).getTime();
			this._tracker[token.id].active[animUid] = {
				queue,
				start: time,
				lastTick: time
			};
		},

		endAnimation (token, animUid) {
			if (this._tracker[token.id] && this._tracker[token.id].active[animUid]) {
				delete this._tracker[token.id].active[animUid];

				if (hasAnyKey(this._tracker[token.id].active)) delete this._tracker[token.id];
			}
		},

		setRestTicks (tickRate) {
			this._restTicks = tickRate;
		},

		_lastTickActive: false,
		_tickTimeout: null,
		doTick () {
			if (this._tickTimeout) clearTimeout(this._tickTimeout);

			if (this._hasAnyActive()) {
				// if we've been sleeping, reset start times
				// prevents an initial "jolt" as anims suddenly have catch up on 1.5s of lag
				if (!this._lastTickActive) {
					this._lastTickActive = true;
					const time = (new Date()).getTime();

					for (const tokenId in this._tracker) {
						if (!this._tracker.hasOwnProperty(tokenId)) continue;
						const tokenMeta = this._tracker[tokenId];

						for (const animUid in tokenMeta.active) {
							if (!tokenMeta.active.hasOwnProperty(animUid)) continue;
							const instance = tokenMeta.active[animUid];
							instance.start = time;
							instance.lastTick = time;
						}
					}
				}

				this._doTick();
			} else {
				this._lastTickActive = false;
				// if none are active, sleep for 1.5 seconds
				this._tickTimeout = setTimeout(() => this.doTick(), 1500);
			}
		},

		_saveState () {
			const toSave = {};
			Object.entries(this._tracker).forEach(([tokenId, tokenMeta]) => {
				const saveableTokenMeta = {active: {}};

				Object.entries(tokenMeta.active).forEach(([animUid, state]) => {
					saveableTokenMeta.active[animUid] = {
						queue: state.queue.map(it => it.serialize()),
						lastAlpha: state.lastAlpha
					};
				});

				toSave[tokenId] = saveableTokenMeta;
			});

			Campaign.save({
				bR20tool__anim_running: toSave
			});
		},

		saveState () {
			if (d20plus.anim.animatorTool.isSavingActive()) this._doSaveStateThrottled();
		},

		loadState () {
			const time = (new Date()).getTime();
			const saved = Campaign.attributes.bR20tool__anim_running ? MiscUtil.copy(Campaign.attributes.bR20tool__anim_running) : {};
			const toLoad = {};
			Object.entries(saved).forEach(([tokenId, savedTokenMeta]) => {
				// load real token
				const token = d20plus.ut.getTokenById(tokenId);
				if (!token) return console.log(`Token ${tokenId} not found!`);
				const tokenMeta = {};
				tokenMeta.token = token;

				const active = {};
				Object.entries(savedTokenMeta.active).forEach(([animUid, savedState]) => {
					const anim = d20plus.anim.animatorTool.getAnimation(animUid);
					if (!anim) return console.log(`Animation ${animUid} not found!`);

					active[animUid] = {
						queue: savedState.queue.map(it => d20plus.anim.deserialize(it)),
						start: time - savedState.lastAlpha,
						lastTick: time
					}
				});

				tokenMeta.active = active;

				toLoad[tokenId] = tokenMeta;
			});

			this._tracker = toLoad;
		},

		_hasAnyActive () {
			return hasAnyKey(this._tracker);
		},

		_doTick () {
			// higher tick rate = slower
			if (++this.__tickCount >= this._restTicks) {
				this.__tickCount = 0;

				const time = (new Date()).getTime();

				for (const tokenId in this._tracker) {
					if (!this._tracker.hasOwnProperty(tokenId)) continue;
					const tokenMeta = this._tracker[tokenId];

					let anyModification = false;
					for (const animUid in tokenMeta.active) {
						if (!tokenMeta.active.hasOwnProperty(animUid)) continue;
						const instance = tokenMeta.active[animUid];

						const alpha = time - instance.start;
						const delta = time - instance.lastTick;

						// avoid using fast-loop length optimization, as we'll splice out completed animations
						for (let i = 0; i < instance.queue.length; ++i) {
							anyModification = instance.queue[i].animate(
								tokenMeta.token,
								alpha,
								delta,
								instance.queue
							) || anyModification;

							if (instance.queue[i].hasRun()) {
								instance.queue.splice(i, 1);
								--i;
							}
						}

						// queue empty -> this animation is no longer active
						if (!instance.queue.length) delete tokenMeta.active[animUid];
						else {
							instance.lastTick = time;
							instance.lastAlpha = alpha;
						}
					}

					// no active animations -> stop tracking this token
					if (!hasAnyKey(tokenMeta.active)) delete this._tracker[tokenId];

					// save after applying animations
					if (anyModification) tokenMeta.token.save();
				}

				this.saveState();
			}

			requestAnimationFrame(this.doTick.bind(this))
		},

		init () {
			this._doSaveStateThrottled = _.throttle(this._saveState, 100);
			setTimeout(() => {
				this.loadState();
				this._lastTickActive = true;
				this.doTick();
			}, 5000);
		},
	};

	// all properties that can be set via the 'prop' command
	d20plus.anim.VALID_PROP_TOKEN = new Set([
		"left",
		"top",
		"width",
		"height",
		"z_index",
		"imgsrc",
		"rotation",
		"type",
		"layer",
		"locked",
		"flipv",
		"fliph",
		"anim_loop",
		"anim_paused_at",
		"anim_autoplay",
		"name",
		"gmnotes", // `escape`d HTML
		"controlledby",
		"represents",
		"bar1_value",
		"bar1_max",
		"bar1_link",
		"bar2_value",
		"bar2_max",
		"bar2_link",
		"bar3_value",
		"bar3_max",
		"bar3_link",
		"aura1_radius",
		"aura1_color",
		"aura1_square",
		"aura2_radius",
		"aura2_color",
		"aura2_square",
		"tint_color",
		"status_dead",
		"statusmarkers",
		"showname",
		"showplayers_name",
		"showplayers_bar1",
		"showplayers_bar2",
		"showplayers_bar3",
		"showplayers_aura1",
		"showplayers_aura2",
		"playersedit_name",
		"playersedit_bar1",
		"playersedit_bar2",
		"playersedit_bar3",
		"playersedit_aura1",
		"playersedit_aura2",
		"light_radius",
		"light_dimradius",
		"light_otherplayers",
		"light_hassight",
		"light_angle",
		"light_losangle",
		"light_multiplier",
		"adv_fow_view_distance",
		"groupwith",
		"sides", // pipe-separated list of `escape`d image URLs
		"currentSide"
	]);

	d20plus.anim._LAYERS = ["map", "objects", "foreground", "gmlayer", "walls", "weather"];
	d20plus.anim.VALID_LAYER = new Set(d20plus.anim._LAYERS);
}

SCRIPT_EXTENSIONS.push(baseToolAnimator);