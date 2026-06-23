// Titles page — create titles from assets, map streams, and configure output profiles.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { useEffect, useState } from 'react';
import { useProjectStore } from '../store/project-store';
import { useNavigation } from '../App';
import { NoProjectState } from '../components/NoProjectState';
import type {
	Title,
	Titleset,
	Asset,
	VideoOutputProfile,
	VideoRaster,
	AspectMode,
	AudioOutputTarget,
	AudioTrackMapping,
	CopyMode,
	PlaybackAction,
	SpindleProjectFile,
	SubtitleStreamInfo,
	SubtitleTrackMapping,
} from '../types/project';
import './TitlesPage.css';

/**
 * Thin wrapper so the no-project guard doesn't sit between hooks.
 *
 * `TitlesWorkspace` below calls `useState` after where the guard used to be;
 * if this component rendered `<NoProjectState>` and then `<TitlesWorkspace>`
 * from the *same* function on a later render (project going from null to
 * non-null without unmounting), React would see a different number of hooks
 * called between renders and throw. Returning a different child *component*
 * for each case means React unmounts/remounts the subtree on that
 * transition instead, so `TitlesWorkspace` only ever mounts once a project
 * already exists.
 */
export function TitlesPage() {
	const project = useProjectStore((s) => s.project);

	if (!project) {
		return (
			<NoProjectState
				title="No Project Open"
				description="Open or create a project to organise titles and configure output profiles."
				icon={
					<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.5">
						<rect x="8" y="8" width="48" height="48" rx="4" />
						<line x1="16" y1="20" x2="48" y2="20" />
						<line x1="16" y1="32" x2="40" y2="32" />
						<line x1="16" y1="44" x2="32" y2="44" />
					</svg>
				}
			/>
		);
	}

	return <TitlesWorkspace />;
}

function TitlesWorkspace() {
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

	// Unreachable in practice — TitlesPage only mounts this component once a
	// project exists, and swaps to a different component (unmounting this
	// one) if it closes. Needed purely for TypeScript's narrowing below.
	if (!project) return null;

	// Select first titleset by default, or follow user selection
	const titleset =
		project.disc.titlesets.find((ts) => ts.id === selectedTitlesetId) ?? project.disc.titlesets[0];
	if (!titleset) return null;

	const titles = titleset.titles;
	const allTitlesFromAllSets = project.disc.titlesets.flatMap((ts) => ts.titles);
	const selectedTitle = allTitlesFromAllSets.find((t) => t.id === selectedTitleId) ?? null;

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

	const handleAddTitle = (targetTitlesetId = titleset.id) => {
		const targetTitleset =
			project.disc.titlesets.find((ts) => ts.id === targetTitlesetId) ?? project.disc.titlesets[0];
		if (!targetTitleset) return;

		const newTitle: Title = {
			id: crypto.randomUUID(),
			name: `Title ${targetTitleset.titles.length + 1}`,
			sourceAssetId: null,
			videoMapping: null,
			videoOutputProfile: null,
			audioMappings: [],
			subtitleMappings: [],
			chapters: [],
			endAction: null,
			orderIndex: targetTitleset.titles.length,
			bitrateWeight: 1.0,
			bitrateFloorBps: null,
			bitrateCeilingBps: null,
			pinnedBitrateBps: null,
		};
		const allTitles = project.disc.titlesets.flatMap((ts) => ts.titles);
		const isFirstTitle = allTitles.length === 0;
		updateProject((p) => {
			const withTitle = updateTitleInProject(p, targetTitleset.id, [
				...targetTitleset.titles,
				newTitle,
			]);
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
		setSelectedTitlesetId(targetTitleset.id);
		setSelectedTitleId(newTitle.id);
	};

	const handleUpdateTitle = (updated: Title) => {
		// Find which titleset owns this title
		const ownerTs = project.disc.titlesets.find((ts) => ts.titles.some((t) => t.id === updated.id));
		if (!ownerTs) return;
		const newTitles = ownerTs.titles.map((t) => (t.id === updated.id ? updated : t));
		updateProject((p) => updateTitleInProject(p, ownerTs.id, newTitles));
	};

	const handleRemoveTitle = (tsId: string, titleId: string) => {
		const ownerTs = project.disc.titlesets.find((ts) => ts.id === tsId);
		if (!ownerTs) return;
		const newTitles = ownerTs.titles
			.filter((t) => t.id !== titleId)
			.map((t, i) => ({ ...t, orderIndex: i }));
		updateProject((p) => updateTitleInProject(p, tsId, newTitles));
		if (selectedTitleId === titleId) setSelectedTitleId(null);
	};

	const handleReorder = (tsId: string, titleId: string, direction: 'up' | 'down') => {
		const ownerTs = project.disc.titlesets.find((ts) => ts.id === tsId);
		if (!ownerTs) return;
		const tsTitles = ownerTs.titles;
		const idx = tsTitles.findIndex((t) => t.id === titleId);
		if (idx < 0) return;
		const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
		if (swapIdx < 0 || swapIdx >= tsTitles.length) return;
		const newTitles = [...tsTitles];
		[newTitles[idx], newTitles[swapIdx]] = [newTitles[swapIdx], newTitles[idx]];
		updateProject((p) =>
			updateTitleInProject(
				p,
				tsId,
				newTitles.map((t, i) => ({ ...t, orderIndex: i })),
			),
		);
	};

	const handleMoveTitle = (titleId: string, targetTitlesetId: string) => {
		// Find the source titleset
		const sourceTs = project.disc.titlesets.find((ts) => ts.titles.some((t) => t.id === titleId));
		if (!sourceTs || sourceTs.id === targetTitlesetId) return;
		const title = sourceTs.titles.find((t) => t.id === titleId);
		if (!title) return;
		updateProject((p) => ({
			...p,
			disc: {
				...p.disc,
				titlesets: p.disc.titlesets.map((ts) => {
					if (ts.id === sourceTs.id) {
						return {
							...ts,
							titles: ts.titles
								.filter((t) => t.id !== titleId)
								.map((t, i) => ({ ...t, orderIndex: i })),
						};
					}
					if (ts.id === targetTitlesetId) {
						return {
							...ts,
							titles: [...ts.titles, { ...title, orderIndex: ts.titles.length }],
						};
					}
					return ts;
				}),
			},
		}));
		setSelectedTitlesetId(targetTitlesetId);
	};

	const [dragOverTitlesetId, setDragOverTitlesetId] = useState<string | null>(null);

	const allTitlesFlat = project.disc.titlesets.flatMap((ts) => ts.titles);
	const hasTitles = allTitlesFlat.length > 0;

	return (
		<div className="titles">
			<div className="page-header">
				<h1 className="page-title">Titles</h1>
				<div className="page-header__actions">
					<button className="btn btn--secondary" onClick={handleAddTitleset}>
						Add Titleset
					</button>
					<button className="btn btn--primary" onClick={() => handleAddTitle()}>
						Add Title
					</button>
				</div>
			</div>

			{!hasTitles && project.disc.titlesets.length === 1 ? (
				<EmptyTitlesView onAdd={handleAddTitle} />
			) : (
				<div className="titles__layout">
					<div className="titles__list">
						{project.disc.titlesets.map((ts) => {
							const tsTitles = ts.titles;
							return (
								<div
									key={ts.id}
									className={`titles__titleset-section ${dragOverTitlesetId === ts.id ? 'titles__titleset-section--drag-over' : ''}`}
									onDragOver={(e) => {
										e.preventDefault();
										setDragOverTitlesetId(ts.id);
									}}
									onDragLeave={(e) => {
										// Only clear if leaving the section entirely
										if (!e.currentTarget.contains(e.relatedTarget as Node)) {
											setDragOverTitlesetId(null);
										}
									}}
									onDrop={(e) => {
										e.preventDefault();
										const titleId = e.dataTransfer.getData('text/x-title-id');
										if (titleId) handleMoveTitle(titleId, ts.id);
										setDragOverTitlesetId(null);
									}}
								>
									<div className="titles__titleset-header">
										<input
											className="titles__titleset-heading"
											value={ts.name}
											onChange={(e) => handleRenameTitleset(ts.id, e.target.value)}
											onClick={() => {
												setSelectedTitlesetId(ts.id);
											}}
										/>
										<span className="titles__titleset-count text-muted">
											{tsTitles.length} {tsTitles.length === 1 ? 'title' : 'titles'}
											{ts.menus.length > 0 &&
												` · ${ts.menus.length} ${ts.menus.length === 1 ? 'menu' : 'menus'}`}
										</span>
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
									{tsTitles.length === 0 ? (
										<div className="titles__titleset-empty text-muted">
											No titles in this titleset.{' '}
											<button
												className="btn-link"
												onClick={() => {
													setSelectedTitlesetId(ts.id);
													handleAddTitle(ts.id);
												}}
											>
												Add one
											</button>
										</div>
									) : (
										tsTitles.map((title, idx) => (
											<TitleRow
												key={title.id}
												title={title}
												index={idx}
												totalCount={tsTitles.length}
												asset={project.assets.find((a) => a.id === title.sourceAssetId) ?? null}
												isSelected={title.id === selectedTitleId}
												onSelect={() => {
													setSelectedTitlesetId(ts.id);
													setSelectedTitleId(title.id);
												}}
												onMoveUp={() => handleReorder(ts.id, title.id, 'up')}
												onMoveDown={() => handleReorder(ts.id, title.id, 'down')}
												onRemove={() => handleRemoveTitle(ts.id, title.id)}
											/>
										))
									)}
								</div>
							);
						})}
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
			draggable
			onDragStart={(e) => {
				e.dataTransfer.setData('text/x-title-id', title.id);
				e.dataTransfer.effectAllowed = 'move';
			}}
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
	const titleSourceAssets = assets.filter(
		(asset) =>
			asset.videoStreams.length > 0 ||
			asset.audioStreams.length > 0 ||
			asset.subtitleStreams.length > 0,
	);
	const selectedAsset = assets.find((a) => a.id === title.sourceAssetId) ?? null;

	const handleAssetChange = (assetId: string) => {
		const asset = assets.find((a) => a.id === assetId);
		if (!asset) return;

		// Auto-map first video stream and create audio mappings
		const videoMapping =
			asset.videoStreams.length > 0
				? { sourceStreamIndex: asset.videoStreams[0].index, copyMode: 'copy' as CopyMode }
				: null;

		const audioCompatByStream = new Map(
			asset.compatibilityDetail?.audioStreams.map((c) => [c.streamIndex, c.codec.compatible]) ?? [],
		);
		const audioMappings = asset.audioStreams.map((as_, i) => {
			const compatible = audioCompatByStream.get(as_.index) ?? false;
			const outputTarget = compatible ? (AUDIO_CODEC_TARGETS[as_.codec] ?? 'AC3') : 'AC3';
			return {
				id: crypto.randomUUID(),
				sourceStreamIndex: as_.index,
				outputTarget: outputTarget as AudioOutputTarget,
				copyMode: (compatible ? 'copy' : 're-encode') as CopyMode,
				label: languageLabel(as_.language ?? null, `Audio ${i + 1}`),
				language: as_.language ?? 'und',
				orderIndex: i,
				isDefault: i === 0,
				channelLayout: null,
			};
		});

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
					{titleSourceAssets.map((a) => (
						<option key={a.id} value={a.id}>
							{a.fileName}
						</option>
					))}
				</select>
			</div>

			{/* Source Metadata */}
			{selectedAsset?.formatTitle && (
				<div className="titles__editor-section">
					<h4 className="titles__editor-heading">Source Metadata</h4>
					<div className="titles__metadata-row">
						<span className="titles__metadata-value text-muted" title={selectedAsset.formatTitle}>
							{selectedAsset.formatTitle}
						</span>
						<button
							className="btn btn--secondary btn--sm"
							onClick={() => onUpdate({ ...title, name: selectedAsset!.formatTitle! })}
						>
							Use Asset Title
						</button>
					</div>
				</div>
			)}

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
					<h4 className="titles__editor-heading">
						Audio Tracks
						<span className="titles__track-count text-muted">
							{` (${title.audioMappings.length}/8)`}
						</span>
					</h4>
					{title.audioMappings.length > 8 && (
						<p className="titles__hint titles__hint--warn">
							DVD-Video supports at most 8 audio streams. Remove tracks to stay within the limit.
						</p>
					)}
					{title.audioMappings.map((am) => (
						<div key={am.id} className="titles__track-row titles__track-row--audio">
							<div className="titles__track-header">
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
								<button
									className="titles__row-remove"
									title="Remove audio track"
									onClick={() =>
										onUpdate({
											...title,
											audioMappings: title.audioMappings
												.filter((a) => a.id !== am.id)
												.map((a, i) => ({ ...a, orderIndex: i })),
										})
									}
								>
									×
								</button>
							</div>
							{audioSourceSummary(selectedAsset, am) && (
								<div className="titles__track-source">{audioSourceSummary(selectedAsset, am)}</div>
							)}
							<div className="titles__track-controls">
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
									onChange={(e) => {
										const copyMode = e.target.value as CopyMode;
										onUpdate({
											...title,
											audioMappings: title.audioMappings.map((a) =>
												a.id === am.id
													? {
															...a,
															copyMode,
															// Channel layout only applies to re-encoded tracks —
															// clear it so a stale selection doesn't silently
															// reappear if the user switches back later.
															channelLayout: copyMode === 'copy' ? null : a.channelLayout,
														}
													: a,
											),
										});
									}}
								>
									<option value="copy">Copy</option>
									<option value="re-encode">Re-encode</option>
								</select>
								<select
									className="titles__select titles__select--sm"
									value={am.channelLayout ?? ''}
									title="Selecting a channel layout switches this track to Re-encode, since a stream copy can't change channels."
									onChange={(e) => {
										const channelLayout = e.target.value === '' ? null : Number(e.target.value);
										onUpdate({
											...title,
											audioMappings: title.audioMappings.map((a) =>
												a.id === am.id
													? {
															...a,
															channelLayout,
															// A stream copy can't change channels — picking a
															// real layout implies re-encoding.
															copyMode: channelLayout !== null ? 're-encode' : a.copyMode,
														}
													: a,
											),
										});
									}}
								>
									<option value="">{`Auto (source${sourceChannelLabel(selectedAsset, am) ? `, ${sourceChannelLabel(selectedAsset, am)}` : ''})`}</option>
									<option value="1">Mono</option>
									<option value="2">Stereo</option>
									<option value="6">5.1</option>
									<option value="8">7.1</option>
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

			{/* Bitrate Allocation */}
			<div className="titles__editor-section">
				<h4 className="titles__editor-heading">Bitrate Allocation</h4>
				<p className="titles__hint text-muted">
					Controls how this title shares the disc-wide bitrate budget on the Planner page.
				</p>
				<div className="titles__editor-row">
					<label className="titles__field-label" htmlFor={`pin-${title.id}`}>
						Pin
					</label>
					<input
						id={`pin-${title.id}`}
						type="checkbox"
						checked={title.pinnedBitrateBps !== null}
						onChange={(e) =>
							onUpdate({
								...title,
								pinnedBitrateBps: e.target.checked ? DEFAULT_PIN_BPS : null,
							})
						}
					/>
					{title.pinnedBitrateBps !== null && (
						<>
							<input
								className="titles__select titles__select--sm"
								type="number"
								min="0"
								step="0.1"
								value={bpsToMbps(title.pinnedBitrateBps)}
								onChange={(e) =>
									onUpdate({ ...title, pinnedBitrateBps: mbpsToBps(e.target.value) ?? 0 })
								}
							/>
							<span className="titles__field-label">Mbps</span>
						</>
					)}
				</div>
				{title.pinnedBitrateBps === null && (
					<>
						<div className="titles__editor-row">
							<label className="titles__field-label" htmlFor={`weight-${title.id}`}>
								Weight
							</label>
							<input
								id={`weight-${title.id}`}
								className="titles__select titles__select--sm"
								type="number"
								min="0"
								step="0.1"
								value={title.bitrateWeight}
								onChange={(e) => onUpdate({ ...title, bitrateWeight: Number(e.target.value) || 0 })}
							/>
							<span className="titles__hint text-muted" style={{ marginBottom: 0 }}>
								Used by priority-weighted allocation.
							</span>
						</div>
						<BitrateBoundRow
							label="Floor"
							titleId={title.id}
							valueBps={title.bitrateFloorBps}
							onChangeBps={(bps) => onUpdate({ ...title, bitrateFloorBps: bps })}
						/>
						<BitrateBoundRow
							label="Ceiling"
							titleId={title.id}
							valueBps={title.bitrateCeilingBps}
							onChangeBps={(bps) => onUpdate({ ...title, bitrateCeilingBps: bps })}
						/>
					</>
				)}
			</div>

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
					<option
						value="playNextInTitleset"
						disabled={allTitles.findIndex((t) => t.id === title.id) === allTitles.length - 1}
					>
						Next in Titleset
					</option>
					<option value="playAllInTitleset" disabled={allTitles.length <= 1}>
						Play All in Titleset
					</option>
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

const DEFAULT_PIN_BPS = 6_000_000;

// Which AudioOutputTarget a DVD-compatible source codec maps to 1:1.
// Compliance itself (the compatible/incompatible judgment) comes from
// asset.compatibilityDetail, computed once in the Rust backend — this table
// only picks the matching output enum once compatibility is already known.
const AUDIO_CODEC_TARGETS: Record<string, AudioOutputTarget> = {
	ac3: 'AC3',
	dts: 'DTS',
	mp2: 'MP2',
	pcm_s16le: 'LPCM',
	pcm_s16be: 'LPCM',
};

const CHANNEL_COUNT_LABELS: Record<number, string> = {
	1: 'mono',
	2: 'stereo',
	6: '5.1',
	8: '7.1',
};

function sourceChannelLabel(asset: Asset | null, mapping: AudioTrackMapping): string | null {
	const channels = asset?.audioStreams.find((s) => s.index === mapping.sourceStreamIndex)?.channels;
	if (!channels) return null;
	return CHANNEL_COUNT_LABELS[channels] ?? `${channels}ch`;
}

function audioSourceSummary(asset: Asset | null, mapping: AudioTrackMapping): string | null {
	const stream = asset?.audioStreams.find((s) => s.index === mapping.sourceStreamIndex);
	if (!stream) return null;
	const parts = [
		stream.codec.toUpperCase(),
		CHANNEL_COUNT_LABELS[stream.channels] ?? `${stream.channels}ch`,
	];
	if (stream.sampleRate) parts.push(`${Math.round(stream.sampleRate / 1000)}kHz`);
	if (stream.language) parts.push(stream.language);
	if (stream.title) parts.push(`"${stream.title}"`);
	return `#${stream.index} — ${parts.join(' · ')}`;
}

function BitrateBoundRow({
	label,
	titleId,
	valueBps,
	onChangeBps,
}: {
	label: string;
	titleId: string;
	valueBps: number | null;
	onChangeBps: (bps: number | null) => void;
}) {
	const inputId = `${label.toLowerCase()}-${titleId}`;
	return (
		<div className="titles__editor-row">
			<label className="titles__field-label" htmlFor={inputId}>
				{label}
			</label>
			<input
				id={inputId}
				className="titles__select titles__select--sm"
				type="number"
				min="0"
				step="0.1"
				value={bpsToMbps(valueBps)}
				onChange={(e) => onChangeBps(mbpsToBps(e.target.value))}
			/>
			<span className="titles__field-label">Mbps</span>
		</div>
	);
}

function bpsToMbps(bps: number | null): number | '' {
	return bps === null ? '' : bps / 1_000_000;
}

function mbpsToBps(value: string): number | null {
	if (value === '') return null;
	const mbps = Number(value);
	return Number.isFinite(mbps) ? Math.max(0, mbps) * 1_000_000 : null;
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
		case 'playNextInTitleset':
			return 'playNextInTitleset';
		case 'playAllInTitleset':
			return 'playAllInTitleset';
		default:
			return '';
	}
}

function stringToEndAction(str: string): PlaybackAction | null {
	if (!str) return null;
	if (str === 'stop') return { type: 'stop' };
	if (str === 'playNextInTitleset') return { type: 'playNextInTitleset' };
	if (str === 'playAllInTitleset') return { type: 'playAllInTitleset' };
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
