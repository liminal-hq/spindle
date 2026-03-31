// Titles page — create titles from assets, map streams, and configure output profiles.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { useEffect, useState } from 'react';
import { useProjectStore } from '../store/project-store';
import { useNavigation } from '../App';
import type {
	Title,
	Titleset,
	Asset,
	VideoOutputProfile,
	VideoRaster,
	AspectMode,
	AudioOutputTarget,
	CopyMode,
	PlaybackAction,
	SpindleProjectFile,
	SubtitleStreamInfo,
	SubtitleTrackMapping,
} from '../types/project';
import './TitlesPage.css';

export function TitlesPage() {
	const project = useProjectStore((s) => s.project);
	const updateProject = useProjectStore((s) => s.updateProject);
	const { consumePendingEntityId } = useNavigation();
	const [selectedTitleId, setSelectedTitleId] = useState<string | null>(null);
	const [selectedTitlesetId, setSelectedTitlesetId] = useState<string | null>(null);

	// Consume navigation target from validation issue click
	useEffect(() => {
		const entityId = consumePendingEntityId();
		if (!entityId || !project) return;
		// Check if it's a title ID
		for (const ts of project.disc.titlesets) {
			if (ts.titles.some((t) => t.id === entityId)) {
				setSelectedTitlesetId(ts.id);
				setSelectedTitleId(entityId);
				return;
			}
			// Check if it's a titleset ID
			if (ts.id === entityId) {
				setSelectedTitlesetId(entityId);
				return;
			}
		}
	}, []); // eslint-disable-line react-hooks/exhaustive-deps

	if (!project) return null;

	// Select first titleset by default, or follow user selection
	const titleset =
		project.disc.titlesets.find((ts) => ts.id === selectedTitlesetId) ?? project.disc.titlesets[0];
	if (!titleset) return null;

	const titles = titleset.titles;
	const selectedTitle = titles.find((t) => t.id === selectedTitleId) ?? null;

	const handleAddTitleset = () => {
		const newTs: Titleset = {
			id: crypto.randomUUID(),
			name: `Titleset ${project.disc.titlesets.length + 1}`,
			titles: [],
			menus: [],
		};
		updateProject((p) => ({
			...p,
			disc: { ...p.disc, titlesets: [...p.disc.titlesets, newTs] },
		}));
		setSelectedTitlesetId(newTs.id);
		setSelectedTitleId(null);
	};

	const handleRemoveTitleset = (tsId: string) => {
		const ts = project.disc.titlesets.find((t) => t.id === tsId);
		if (!ts || ts.titles.length > 0 || ts.menus.length > 0) return;
		if (project.disc.titlesets.length <= 1) return;
		updateProject((p) => ({
			...p,
			disc: { ...p.disc, titlesets: p.disc.titlesets.filter((t) => t.id !== tsId) },
		}));
		if (selectedTitlesetId === tsId) {
			setSelectedTitlesetId(null);
			setSelectedTitleId(null);
		}
	};

	const handleRenameTitleset = (tsId: string, name: string) => {
		updateProject((p) => ({
			...p,
			disc: {
				...p.disc,
				titlesets: p.disc.titlesets.map((ts) => (ts.id === tsId ? { ...ts, name } : ts)),
			},
		}));
	};

	const handleAddTitle = () => {
		const newTitle: Title = {
			id: crypto.randomUUID(),
			name: `Title ${titles.length + 1}`,
			sourceAssetId: null,
			videoMapping: null,
			videoOutputProfile: null,
			audioMappings: [],
			subtitleMappings: [],
			chapters: [],
			endAction: null,
			orderIndex: titles.length,
		};
		const allTitles = project.disc.titlesets.flatMap((ts) => ts.titles);
		const isFirstTitle = allTitles.length === 0;
		updateProject((p) => {
			const withTitle = updateTitleInProject(p, titleset.id, [...titles, newTitle]);
			// Auto-set first-play to this title when adding the very first title
			if (isFirstTitle && !p.disc.firstPlayAction) {
				return {
					...withTitle,
					disc: {
						...withTitle.disc,
						firstPlayAction: { type: 'playTitle', titleId: newTitle.id },
					},
				};
			}
			return withTitle;
		});
		setSelectedTitleId(newTitle.id);
	};

	const handleUpdateTitle = (updated: Title) => {
		const newTitles = titles.map((t) => (t.id === updated.id ? updated : t));
		updateProject((p) => updateTitleInProject(p, titleset.id, newTitles));
	};

	const handleRemoveTitle = (titleId: string) => {
		const newTitles = titles
			.filter((t) => t.id !== titleId)
			.map((t, i) => ({ ...t, orderIndex: i }));
		updateProject((p) => updateTitleInProject(p, titleset.id, newTitles));
		if (selectedTitleId === titleId) setSelectedTitleId(null);
	};

	const handleReorder = (titleId: string, direction: 'up' | 'down') => {
		const idx = titles.findIndex((t) => t.id === titleId);
		if (idx < 0) return;
		const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
		if (swapIdx < 0 || swapIdx >= titles.length) return;
		const newTitles = [...titles];
		[newTitles[idx], newTitles[swapIdx]] = [newTitles[swapIdx], newTitles[idx]];
		updateProject((p) =>
			updateTitleInProject(
				p,
				titleset.id,
				newTitles.map((t, i) => ({ ...t, orderIndex: i })),
			),
		);
	};

	return (
		<div className="titles">
			<div className="page-header">
				<h1 className="page-title">Titles</h1>
				<button className="btn btn--primary" onClick={handleAddTitle}>
					Add Title
				</button>
			</div>

			{/* Titleset selector — compact when only one exists */}
			{project.disc.titlesets.length > 1 || true ? (
				<div className="titles__titleset-bar">
					{project.disc.titlesets.map((ts) => (
						<div
							key={ts.id}
							className={`titles__titleset-tab ${ts.id === titleset.id ? 'titles__titleset-tab--active' : ''}`}
						>
							<input
								className="titles__titleset-name"
								value={ts.name}
								onChange={(e) => handleRenameTitleset(ts.id, e.target.value)}
								onClick={() => {
									setSelectedTitlesetId(ts.id);
									setSelectedTitleId(null);
								}}
							/>
							{ts.titles.length === 0 &&
								ts.menus.length === 0 &&
								project.disc.titlesets.length > 1 && (
									<button
										className="titles__titleset-remove"
										onClick={() => handleRemoveTitleset(ts.id)}
										title="Remove empty titleset"
									>
										×
									</button>
								)}
						</div>
					))}
					<button className="btn btn--secondary btn--sm" onClick={handleAddTitleset}>
						+ Titleset
					</button>
				</div>
			) : null}

			{titles.length === 0 ? (
				<EmptyTitlesView onAdd={handleAddTitle} />
			) : (
				<div className="titles__layout">
					<div className="titles__list">
						{titles.map((title, idx) => (
							<TitleRow
								key={title.id}
								title={title}
								index={idx}
								totalCount={titles.length}
								asset={project.assets.find((a) => a.id === title.sourceAssetId) ?? null}
								isSelected={title.id === selectedTitleId}
								onSelect={() => setSelectedTitleId(title.id)}
								onMoveUp={() => handleReorder(title.id, 'up')}
								onMoveDown={() => handleReorder(title.id, 'down')}
								onRemove={() => handleRemoveTitle(title.id)}
							/>
						))}
					</div>
					{selectedTitle && (
						<TitleEditor
							title={selectedTitle}
							assets={project.assets}
							standard={project.disc.standard}
							allTitles={titles}
							allMenus={[
								...project.disc.globalMenus,
								...project.disc.titlesets.flatMap((ts) => ts.menus),
							]}
							onUpdate={handleUpdateTitle}
						/>
					)}
				</div>
			)}
		</div>
	);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function updateTitleInProject(
	project: SpindleProjectFile,
	titlesetId: string,
	newTitles: Title[],
): SpindleProjectFile {
	return {
		...project,
		disc: {
			...project.disc,
			titlesets: project.disc.titlesets.map((ts) =>
				ts.id === titlesetId ? { ...ts, titles: newTitles } : ts,
			),
		},
	};
}

// ── Sub-components ──────────────────────────────────────────────────────────

function EmptyTitlesView({ onAdd }: { onAdd: () => void }) {
	return (
		<div className="titles__empty">
			<svg
				className="titles__empty-icon"
				viewBox="0 0 64 64"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.5"
			>
				<rect x="8" y="8" width="48" height="48" rx="4" />
				<line x1="16" y1="20" x2="48" y2="20" />
				<line x1="16" y1="32" x2="40" y2="32" />
				<line x1="16" y1="44" x2="32" y2="44" />
			</svg>
			<h2>No titles yet</h2>
			<p className="text-muted">
				Add titles to define the playback structure of your disc. Each title maps to a source asset
				with explicit stream selections.
			</p>
			<button className="btn btn--primary" onClick={onAdd}>
				Add Title
			</button>
		</div>
	);
}

function TitleRow({
	title,
	index,
	totalCount,
	asset,
	isSelected,
	onSelect,
	onMoveUp,
	onMoveDown,
	onRemove,
}: {
	title: Title;
	index: number;
	totalCount: number;
	asset: Asset | null;
	isSelected: boolean;
	onSelect: () => void;
	onMoveUp: () => void;
	onMoveDown: () => void;
	onRemove: () => void;
}) {
	return (
		<div
			className={`titles__row card ${isSelected ? 'titles__row--selected' : ''}`}
			onClick={onSelect}
			role="button"
			tabIndex={0}
			onKeyDown={(e) => e.key === 'Enter' && onSelect()}
		>
			<div className="titles__row-order">
				<button
					className="titles__order-btn"
					disabled={index === 0}
					onClick={(e) => {
						e.stopPropagation();
						onMoveUp();
					}}
					title="Move up"
				>
					▲
				</button>
				<span className="titles__order-num">{index + 1}</span>
				<button
					className="titles__order-btn"
					disabled={index === totalCount - 1}
					onClick={(e) => {
						e.stopPropagation();
						onMoveDown();
					}}
					title="Move down"
				>
					▼
				</button>
			</div>
			<div className="titles__row-main">
				<span className="titles__row-name">{title.name}</span>
				<span className="titles__row-asset text-muted">
					{asset ? asset.fileName : 'No asset assigned'}
				</span>
			</div>
			<div className="titles__row-badges">
				{title.videoMapping && <span className="badge badge--neutral">Video</span>}
				{title.audioMappings.length > 0 && (
					<span className="badge badge--neutral">{title.audioMappings.length} Audio</span>
				)}
				{title.chapters.length > 0 && (
					<span className="badge badge--neutral">{title.chapters.length} Ch</span>
				)}
				{!title.sourceAssetId && <span className="badge badge--unsupported">No Source</span>}
			</div>
			<button
				className="titles__row-remove"
				onClick={(e) => {
					e.stopPropagation();
					onRemove();
				}}
				title="Remove title"
			>
				×
			</button>
		</div>
	);
}

function TitleEditor({
	title,
	assets,
	standard,
	allTitles,
	allMenus,
	onUpdate,
}: {
	title: Title;
	assets: Asset[];
	standard: string;
	allTitles: { id: string; name: string; chapters: { id: string; name: string }[] }[];
	allMenus: { id: string; name: string }[];
	onUpdate: (title: Title) => void;
}) {
	const selectedAsset = assets.find((a) => a.id === title.sourceAssetId) ?? null;

	const handleAssetChange = (assetId: string) => {
		const asset = assets.find((a) => a.id === assetId);
		if (!asset) return;

		// Auto-map first video stream and create audio mappings
		const videoMapping =
			asset.videoStreams.length > 0
				? { sourceStreamIndex: asset.videoStreams[0].index, copyMode: 'copy' as CopyMode }
				: null;

		const audioMappings = asset.audioStreams.map((as_, i) => ({
			id: crypto.randomUUID(),
			sourceStreamIndex: as_.index,
			outputTarget: 'AC3' as AudioOutputTarget,
			copyMode: (as_.codec === 'ac3' ? 'copy' : 're-encode') as CopyMode,
			label: languageLabel(as_.language ?? null, `Audio ${i + 1}`),
			language: as_.language ?? 'und',
			orderIndex: i,
			isDefault: i === 0,
		}));

		const subtitleMappings = asset.subtitleStreams.map((ss, i) => ({
			id: crypto.randomUUID(),
			sourceStreamIndex: ss.index,
			label: ss.title ?? languageLabel(ss.language ?? null, `Subtitle ${i + 1}`),
			language: ss.language ?? 'und',
			orderIndex: i,
			isDefault: i === 0,
			isForced: false,
		}));

		// Auto-select a default output profile
		const videoOutputProfile: VideoOutputProfile = {
			raster: 'full-d1' as VideoRaster,
			aspect:
				(asset.videoStreams[0]?.width ?? 720) > 700
					? ('sixteen-by-nine' as AspectMode)
					: ('four-by-three' as AspectMode),
		};

		// Auto-seed chapters from source asset metadata when available
		const chapters =
			title.chapters.length === 0 && asset.sourceChapters?.length > 0
				? asset.sourceChapters.map((ch, i) => ({
						id: crypto.randomUUID(),
						name: ch.title ?? `Chapter ${i + 1}`,
						timestampSecs: ch.startSecs,
						orderIndex: i,
					}))
				: title.chapters;

		onUpdate({
			...title,
			sourceAssetId: assetId,
			videoMapping,
			videoOutputProfile,
			audioMappings,
			subtitleMappings,
			chapters,
		});
	};

	return (
		<div className="titles__editor card">
			<div className="card__header">
				<input
					className="titles__editor-name"
					value={title.name}
					onChange={(e) => onUpdate({ ...title, name: e.target.value })}
				/>
			</div>

			{/* Source Asset */}
			<div className="titles__editor-section">
				<h4 className="titles__editor-heading">Source Asset</h4>
				<select
					className="titles__select"
					value={title.sourceAssetId ?? ''}
					onChange={(e) => e.target.value && handleAssetChange(e.target.value)}
				>
					<option value="">Select an asset…</option>
					{assets.map((a) => (
						<option key={a.id} value={a.id}>
							{a.fileName}
						</option>
					))}
				</select>
			</div>

			{/* Video Output Profile */}
			{title.videoOutputProfile && (
				<div className="titles__editor-section">
					<h4 className="titles__editor-heading">Video Output</h4>
					<div className="titles__editor-row">
						<label className="titles__field-label">Raster</label>
						<select
							className="titles__select"
							value={title.videoOutputProfile.raster}
							onChange={(e) =>
								onUpdate({
									...title,
									videoOutputProfile: {
										...title.videoOutputProfile!,
										raster: e.target.value as VideoRaster,
									},
								})
							}
						>
							<option value="full-d1">
								Full D1 ({standard === 'NTSC' ? '720×480' : '720×576'})
							</option>
							<option value="704-wide">
								704-wide ({standard === 'NTSC' ? '704×480' : '704×576'})
							</option>
							<option value="half-d1">
								Half D1 ({standard === 'NTSC' ? '352×480' : '352×576'})
							</option>
							<option value="quarter-d1">
								Quarter D1 ({standard === 'NTSC' ? '352×240' : '352×288'})
							</option>
						</select>
					</div>
					<div className="titles__editor-row">
						<label className="titles__field-label">Aspect</label>
						<select
							className="titles__select"
							value={title.videoOutputProfile.aspect}
							onChange={(e) =>
								onUpdate({
									...title,
									videoOutputProfile: {
										...title.videoOutputProfile!,
										aspect: e.target.value as AspectMode,
									},
								})
							}
						>
							<option value="four-by-three">4:3</option>
							<option value="sixteen-by-nine">16:9</option>
						</select>
					</div>
				</div>
			)}

			{/* Video Stream */}
			{selectedAsset && selectedAsset.videoStreams.length > 0 && (
				<div className="titles__editor-section">
					<h4 className="titles__editor-heading">Video Stream</h4>
					<select
						className="titles__select"
						value={title.videoMapping?.sourceStreamIndex ?? ''}
						onChange={(e) =>
							onUpdate({
								...title,
								videoMapping: {
									sourceStreamIndex: Number(e.target.value),
									copyMode: 'copy',
								},
							})
						}
					>
						{selectedAsset.videoStreams.map((vs) => (
							<option key={vs.index} value={vs.index}>
								#{vs.index} — {vs.codec} {vs.width}×{vs.height}
								{vs.frameRate ? ` @ ${vs.frameRate.toFixed(2)} fps` : ''}
							</option>
						))}
					</select>
				</div>
			)}

			{/* Audio Mappings */}
			{title.audioMappings.length > 0 && (
				<div className="titles__editor-section">
					<h4 className="titles__editor-heading">Audio Tracks</h4>
					{title.audioMappings.map((am) => (
						<div key={am.id} className="titles__track-row">
							<input
								className="titles__track-label"
								value={am.label}
								onChange={(e) =>
									onUpdate({
										...title,
										audioMappings: title.audioMappings.map((a) =>
											a.id === am.id ? { ...a, label: e.target.value } : a,
										),
									})
								}
							/>
							<select
								className="titles__select titles__select--sm"
								value={am.outputTarget}
								onChange={(e) =>
									onUpdate({
										...title,
										audioMappings: title.audioMappings.map((a) =>
											a.id === am.id
												? { ...a, outputTarget: e.target.value as AudioOutputTarget }
												: a,
										),
									})
								}
							>
								<option value="AC3">AC3 (Dolby Digital)</option>
								<option value="LPCM">LPCM</option>
								<option value="MP2">MP2</option>
								<option value="DTS">DTS</option>
							</select>
							<select
								className="titles__select titles__select--sm"
								value={am.copyMode}
								onChange={(e) =>
									onUpdate({
										...title,
										audioMappings: title.audioMappings.map((a) =>
											a.id === am.id ? { ...a, copyMode: e.target.value as CopyMode } : a,
										),
									})
								}
							>
								<option value="copy">Copy</option>
								<option value="re-encode">Re-encode</option>
							</select>
							<input
								className="titles__track-lang"
								value={am.language}
								onChange={(e) =>
									onUpdate({
										...title,
										audioMappings: title.audioMappings.map((a) =>
											a.id === am.id ? { ...a, language: e.target.value } : a,
										),
									})
								}
								maxLength={3}
								title="ISO 639-2 language code"
							/>
						</div>
					))}
				</div>
			)}

			{/* Subtitle Mappings */}
			{selectedAsset && (
				<div className="titles__editor-section">
					<h4 className="titles__editor-heading">
						Subtitle Tracks
						<span className="titles__track-count text-muted">
							{` (${title.subtitleMappings.length}/8)`}
						</span>
					</h4>
					{title.subtitleMappings.length > 8 && (
						<p className="titles__hint titles__hint--warn">
							DVD-Video supports at most 8 subtitle streams. Remove tracks to stay within the limit.
						</p>
					)}
					{title.subtitleMappings.map((sm) => (
						<div key={sm.id} className="titles__track-row">
							<input
								className="titles__track-label"
								value={sm.label}
								onChange={(e) =>
									onUpdate({
										...title,
										subtitleMappings: title.subtitleMappings.map((s) =>
											s.id === sm.id ? { ...s, label: e.target.value } : s,
										),
									})
								}
							/>
							<input
								className="titles__track-lang"
								value={sm.language}
								onChange={(e) =>
									onUpdate({
										...title,
										subtitleMappings: title.subtitleMappings.map((s) =>
											s.id === sm.id ? { ...s, language: e.target.value } : s,
										),
									})
								}
								maxLength={3}
								title="ISO 639-2 language code"
							/>
							<label className="titles__track-flag">
								<input
									type="checkbox"
									checked={sm.isDefault}
									onChange={(e) =>
										onUpdate({
											...title,
											subtitleMappings: title.subtitleMappings.map((s) =>
												s.id === sm.id ? { ...s, isDefault: e.target.checked } : s,
											),
										})
									}
								/>
								Default
							</label>
							<label className="titles__track-flag">
								<input
									type="checkbox"
									checked={sm.isForced}
									onChange={(e) =>
										onUpdate({
											...title,
											subtitleMappings: title.subtitleMappings.map((s) =>
												s.id === sm.id ? { ...s, isForced: e.target.checked } : s,
											),
										})
									}
								/>
								Forced
							</label>
							<button
								className="titles__row-remove"
								title="Remove subtitle track"
								onClick={() =>
									onUpdate({
										...title,
										subtitleMappings: title.subtitleMappings
											.filter((s) => s.id !== sm.id)
											.map((s, i) => ({ ...s, orderIndex: i })),
									})
								}
							>
								×
							</button>
						</div>
					))}
					<SubtitleAddPicker
						asset={selectedAsset}
						currentMappings={title.subtitleMappings}
						onAdd={(stream) => {
							const idx = title.subtitleMappings.length;
							onUpdate({
								...title,
								subtitleMappings: [
									...title.subtitleMappings,
									{
										id: crypto.randomUUID(),
										sourceStreamIndex: stream.index,
										label:
											stream.title ?? languageLabel(stream.language ?? null, `Subtitle ${idx + 1}`),
										language: stream.language ?? 'und',
										orderIndex: idx,
										isDefault: false,
										isForced: false,
									},
								],
							});
						}}
					/>
				</div>
			)}

			{/* End Action */}
			<div className="titles__editor-section">
				<h4 className="titles__editor-heading">End Action</h4>
				<p className="titles__hint text-muted">What happens when this title finishes playing.</p>
				<select
					className="titles__select"
					value={endActionToString(title.endAction)}
					onChange={(e) => onUpdate({ ...title, endAction: stringToEndAction(e.target.value) })}
				>
					<option value="">None (stop playback)</option>
					<option value="stop">Stop</option>
					<optgroup label="Play Title">
						{allTitles
							.filter((t) => t.id !== title.id)
							.map((t) => (
								<option key={t.id} value={`playTitle:${t.id}`}>
									{t.name}
								</option>
							))}
					</optgroup>
					{allTitles.some((t) => t.id !== title.id && t.chapters.length > 0) && (
						<optgroup label="Play Chapter">
							{allTitles
								.filter((t) => t.id !== title.id && t.chapters.length > 0)
								.flatMap((t) =>
									t.chapters.map((ch) => (
										<option key={`${t.id}:${ch.id}`} value={`playChapter:${t.id}:${ch.id}`}>
											{t.name} — {ch.name}
										</option>
									)),
								)}
						</optgroup>
					)}
					<optgroup label="Show Menu">
						{allMenus.map((m) => (
							<option key={m.id} value={`showMenu:${m.id}`}>
								{m.name}
							</option>
						))}
					</optgroup>
				</select>
			</div>
		</div>
	);
}

function endActionToString(action: PlaybackAction | null): string {
	if (!action) return '';
	switch (action.type) {
		case 'playTitle':
			return `playTitle:${action.titleId}`;
		case 'playChapter':
			return `playChapter:${action.titleId}:${action.chapterId}`;
		case 'showMenu':
			return `showMenu:${action.menuId}`;
		case 'stop':
			return 'stop';
		default:
			return '';
	}
}

function stringToEndAction(str: string): PlaybackAction | null {
	if (!str) return null;
	if (str === 'stop') return { type: 'stop' };
	const parts = str.split(':');
	const type = parts[0];
	if (type === 'playTitle' && parts[1]) return { type: 'playTitle', titleId: parts[1] };
	if (type === 'playChapter' && parts[1] && parts[2])
		return { type: 'playChapter', titleId: parts[1], chapterId: parts[2] };
	if (type === 'showMenu' && parts[1]) return { type: 'showMenu', menuId: parts[1] };
	return null;
}

function SubtitleAddPicker({
	asset,
	currentMappings,
	onAdd,
}: {
	asset: Asset;
	currentMappings: SubtitleTrackMapping[];
	onAdd: (stream: SubtitleStreamInfo) => void;
}) {
	const mappedIndices = new Set(currentMappings.map((m) => m.sourceStreamIndex));
	const unmapped = asset.subtitleStreams.filter((s) => !mappedIndices.has(s.index));

	if (unmapped.length === 0) {
		if (asset.subtitleStreams.length === 0) return null;
		return (
			<p className="titles__hint text-muted">
				All subtitle streams from this asset are already mapped.
			</p>
		);
	}

	return (
		<select
			className="titles__select"
			value=""
			onChange={(e) => {
				const stream = unmapped.find((s) => s.index === Number(e.target.value));
				if (stream) onAdd(stream);
			}}
		>
			<option value="">Add subtitle track…</option>
			{unmapped.map((s) => (
				<option key={s.index} value={s.index}>
					#{s.index} — {s.codec} {s.language ?? 'und'}
					{s.title ? ` (${s.title})` : ''}
				</option>
			))}
		</select>
	);
}

// ── Language helpers ─────────────────────────────────────────────────────────

const ISO_639_NAMES: Record<string, string> = {
	// Terminological (ISO 639-2/T) codes
	eng: 'English',
	fra: 'French',
	deu: 'German',
	spa: 'Spanish',
	ita: 'Italian',
	por: 'Portuguese',
	jpn: 'Japanese',
	zho: 'Chinese',
	kor: 'Korean',
	rus: 'Russian',
	ara: 'Arabic',
	hin: 'Hindi',
	nld: 'Dutch',
	pol: 'Polish',
	swe: 'Swedish',
	nor: 'Norwegian',
	dan: 'Danish',
	fin: 'Finnish',
	ces: 'Czech',
	hun: 'Hungarian',
	ron: 'Romanian',
	tur: 'Turkish',
	heb: 'Hebrew',
	tha: 'Thai',
	vie: 'Vietnamese',
	ind: 'Indonesian',
	// Bibliographic (ISO 639-2/B) codes — used by ffprobe
	fre: 'French',
	ger: 'German',
	chi: 'Chinese',
	dut: 'Dutch',
	cze: 'Czech',
	rum: 'Romanian',
	bul: 'Bulgarian',
	hrv: 'Croatian',
	slk: 'Slovak',
	alb: 'Albanian',
	arm: 'Armenian',
	baq: 'Basque',
	geo: 'Georgian',
	ice: 'Icelandic',
	mac: 'Macedonian',
	mao: 'Māori',
	may: 'Malay',
	per: 'Persian',
	wel: 'Welsh',
	und: 'Undetermined',
};

function languageLabel(code: string | null, fallback: string): string {
	if (!code || code === 'und') return fallback;
	return ISO_639_NAMES[code.toLowerCase()] ?? code;
}
