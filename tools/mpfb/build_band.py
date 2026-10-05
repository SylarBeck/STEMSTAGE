"""
Bakes the band members' bodies, hair and clothes from MPFB (MakeHuman for Blender) into two rigged glTF files,
public/models/band-m.glb and band-f.glb, which game/figure.js dresses and animates.

Run (Blender 4.2+ with the MPFB extension and the MakeHuman system assets installed):
    blender -b --python tools/mpfb/build_band.py -- <out-dir> [m|f ...]

Every file holds one game_engine skeleton, the body, eyes, brows and lashes, and every wardrobe piece fitted to that
body. Wardrobe pieces are named <field>.<id> (hair.long, top.tee, legs.jeans, feet.boots, hat.fedora, face.beard) and
are all hidden but one per field at run time. Body shapes are morph targets (slim, broad, and three face shapes)
baked from extra MPFB builds with the same assets, so every piece follows the body.

The human itself is MPFB's, unedited. The body carries a `_hide` attribute: one bit per clothing piece (HIDE_BITS)
for the body vertices that piece covers (measured: a ray out along the skin's normal hits the garment), so the game
skips drawing covered skin and nothing pokes through, whatever top, bottoms and shoes are combined.

No MakeHuman branding: the tee and long sleeve are the MakeHuman shapes with a plain cotton texture made here (their own
textures carry the MakeHuman logo and are never used), and the other suits with the logo are left out.

Textures are made grey (skin keeps a little colour) so the game tints them with the player's colours.
The MakeHuman system assets are CC0.
"""
import bpy, bmesh, os, sys, math, json
import numpy as np
from mathutils import Vector
from bl_ext.user_default.mpfb.services.humanservice import HumanService
from bl_ext.user_default.mpfb.services.targetservice import TargetService
from bl_ext.user_default.mpfb.services.locationservice import LocationService

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = os.path.abspath(ARGS[0] if ARGS else 'public/models')
SEXES = ARGS[1:] or ['m', 'f']
DATA = LocationService.get_user_data()

# ------------------------------------------------------------------ catalogue
# suit -> pieces. A piece is the suit's loose parts that are tops (above the hips) or bottoms (legs).
# (male_casualsuit04 and female_casualsuit01/02 carry the MakeHuman logo: not used; 06 and 02 only for their shapes)
SUITS = {
    'male_casualsuit06': {'top': 'tee'},
    'male_casualsuit02': {'top': 'longsleeve'},
    'male_worksuit01': {'legs': 'overalls'},
    'male_casualsuit03': {'top': 'shirt', 'legs': 'jeans'},
    'male_casualsuit05': {'top': 'jacket'},
    'male_elegantsuit01': {'top': 'suit', 'legs': 'slacks'},
    'female_elegantsuit01': {'top': 'blouse', 'legs': 'skirt'},
    'female_sportsuit01': {'top': 'crop'},  # (its leggings are ripped: holes in the mesh)
}
SHOES = {'sneakers': 'shoes05', 'runners': 'shoes06', 'boots': 'shoes03', 'dress': 'shoes04', 'brogues': 'shoes01', 'hikers': 'shoes02'}
HATS = {'fedora': 'fedora01'}
# MakeHuman's own hair, unedited
HAIR = {
    'short': 'short02', 'long': 'long01', 'spiky': 'short01', 'fringe': 'short03', 'slick': 'short04',
    'bob': 'bob01', 'lob': 'bob02', 'curls': 'afro01', 'ponytail': 'ponytail01', 'locs': 'braid01',
}
OWN_SHADING = {'afro01'}  # curls: its light and dark are the curls, so it skips the evening-out
# body vertices hidden per piece (bit index into the body's _hide attribute; at most 24 bits in a float)
PLAIN_TOPS = {'male_casualsuit06', 'male_casualsuit02'}  # their own textures carry the logo
HIDE_BITS = ['top.tee', 'top.longsleeve', 'top.shirt', 'top.blouse', 'top.jacket', 'top.suit', 'top.crop',
             'legs.jeans', 'legs.slacks', 'legs.skirt', 'legs.overalls',
             'feet.sneakers', 'feet.runners', 'feet.boots', 'feet.dress', 'feet.brogues', 'feet.hikers']
assert len(HIDE_BITS) <= 24

BASE = {'gender': 0.5, 'age': 0.5, 'muscle': 0.5, 'weight': 0.5, 'proportions': 0.8, 'height': 0.5, 'cupsize': 0.5, 'firmness': 0.6,
        'race': {'asian': 0.333, 'caucasian': 0.333, 'african': 0.334}}
VARIANTS = {
    'slim': {'muscle': 0.32, 'weight': 0.12},
    'broad': {'muscle': 0.95, 'weight': 0.78},
    'faceA': {'race': {'asian': 0.0, 'caucasian': 0.0, 'african': 1.0}},
    'faceB': {'race': {'asian': 1.0, 'caucasian': 0.0, 'african': 0.0}},
    'faceC': {'race': {'asian': 0.0, 'caucasian': 1.0, 'african': 0.0}},
}
UPPER_BONES = {'spine_02', 'spine_03', 'neck_01', 'head'} | {f'{b}_{s}' for b in ('clavicle', 'upperarm', 'lowerarm', 'hand') for s in 'lr'}
ARM_BONES = {f'{b}_{s}' for b in ('upperarm', 'lowerarm', 'hand') for s in 'lr'}
SEL = {}  # vertex/face selections made on the first (base) build, reused by the morph builds so topology matches


def mhclo(cat, name):
    return os.path.join(DATA, cat, name, name + '.mhclo')


def dominant(obj):
    """Dominant deform bone per vertex."""
    names = {g.index: g.name for g in obj.vertex_groups}
    out = []
    for v in obj.data.vertices:
        best, w = None, 0
        for g in v.groups:
            n = names[g.group]
            if n.startswith('Delete') or n in ('lips', 'ears', 'fingernails', 'toenails'):
                continue
            if g.weight > w: best, w = n, g.weight
        out.append(best)
    return out


def loose_parts(obj):
    b = bmesh.new(); b.from_mesh(obj.data); b.verts.ensure_lookup_table()
    seen = [-1] * len(b.verts); parts = []
    for v in b.verts:
        if seen[v.index] >= 0: continue
        idx = len(parts); stack = [v]; seen[v.index] = idx; vs = []
        while stack:
            x = stack.pop(); vs.append(x.index)
            for e in x.link_edges:
                y = e.other_vert(x)
                if seen[y.index] < 0: seen[y.index] = idx; stack.append(y)
        parts.append(vs)
    b.free()
    return parts


def keep_verts(obj, keep):
    """Delete every vertex not in keep (a set of indices)."""
    b = bmesh.new(); b.from_mesh(obj.data); b.verts.ensure_lookup_table()
    bmesh.ops.delete(b, geom=[v for v in b.verts if v.index not in keep], context='VERTS')
    b.to_mesh(obj.data); b.free()


def dup(obj, name):
    o = obj.copy(); o.data = obj.data.copy(); o.name = name
    bpy.context.scene.collection.objects.link(o)
    return o


def tag(o, name, tex=None, kind='cloth'):
    o.name = name
    o['piece'] = name
    o['kind'] = kind
    if tex: o['tex'] = tex
    return o


def mat_texture(cat, asset):
    """The diffuse (and normal) texture paths named in an asset's .mhmat."""
    folder = os.path.join(DATA, cat, asset)
    d = n = None
    for f in os.listdir(folder):
        if f.endswith('.mhmat'):
            for line in open(os.path.join(folder, f), encoding='utf-8', errors='ignore'):
                k = line.strip().split(' ', 1)
                if len(k) == 2 and k[0] == 'diffuseTexture': d = os.path.join(folder, k[1].strip())
                if len(k) == 2 and k[0] == 'normalmapTexture': n = os.path.join(folder, k[1].strip())
    return d, n


# ------------------------------------------------------------------ one build
def build(sex, pheno, first):
    for o in list(bpy.data.objects): bpy.data.objects.remove(o)
    for m in list(bpy.data.meshes): bpy.data.meshes.remove(m)
    for a in list(bpy.data.armatures): bpy.data.armatures.remove(a)
    ph = json.loads(json.dumps(BASE))
    ph['gender'] = 1.0 if sex == 'm' else 0.0
    for k, v in pheno.items(): ph[k] = v
    info = {'phenotype': ph, 'rig': 'game_engine', 'targets': [],
            'proxy': 'male_generic/male_generic.proxy' if sex == 'm' else 'female_generic/female_generic.proxy',
            'eyes': 'low-poly/low-poly.mhclo',
            'eyebrows': ('eyebrow001/eyebrow001.mhclo' if sex == 'm' else 'eyebrow010/eyebrow010.mhclo'),
            'eyelashes': ('eyelashes01/eyelashes01.mhclo' if sex == 'm' else 'eyelashes04/eyelashes04.mhclo'),
            'skin_mhmat': 'young_caucasian_male/young_caucasian_male.mhmat', 'skin_material_type': 'MAKESKIN'}
    st = HumanService.get_default_deserialization_settings(); st['subdiv_levels'] = 0
    basemesh = HumanService.deserialize_from_dict(info, st)
    rig = basemesh.parent
    out = {}
    def add(cat, asset):
        return HumanService.add_mhclo_asset(mhclo(cat, asset), basemesh, asset_type='Clothes', subdiv_levels=0)

    body = next(o for o in bpy.data.objects if o.type == 'MESH' and o.name.endswith('_generic'))
    for o in bpy.data.objects:
        if o.type != 'MESH' or o is basemesh: continue
        n = o.name.lower()
        if 'eyebrow' in n: out['eyebrows'] = tag(o, 'eyebrows', mat_texture('eyebrows', o.name.split('.')[-1])[0], 'brows')
        elif 'eyelash' in n: out['eyelashes'] = tag(o, 'eyelashes', mat_texture('eyelashes', o.name.split('.')[-1])[0], 'lashes')
        elif 'low-poly' in n: out['eyes'] = tag(o, 'eyes', os.path.join(DATA, 'eyes', 'materials', 'brown_eye.png'), 'eyes')
    out['body'] = tag(body, 'body', mat_texture('skins', 'young_caucasian_male' if sex == 'm' else 'young_caucasian_female')[0], 'skin')
    bdom = dominant(body)
    bz = [v.co.z for v in body.data.vertices]

    # clothes: split suits into pieces
    for suit, pieces in SUITS.items():
        o = add('clothes', suit)
        dtex, ntex = mat_texture('clothes', suit)
        if suit in PLAIN_TOPS: dtex, ntex = '@plain', None
        if f'split.{suit}' not in SEL:
            zs = [v.co.z for v in o.data.vertices]
            tops, legs = set(), set()
            for p in loose_parts(o):
                mn, mx = min(zs[i] for i in p), max(zs[i] for i in p)
                (legs if (mn < 0.7 or mx < 1.15) else tops).update(p)
            SEL[f'split.{suit}'] = (tops, legs)
        tops, legs = SEL[f'split.{suit}']
        for field, pid in pieces.items():
            piece = dup(o, f'{field}.{pid}')
            keep_verts(piece, tops if field == 'top' else legs)
            out[f'{field}.{pid}'] = tag(piece, f'{field}.{pid}', dtex)
            piece['normal'] = ntex or ''
        bpy.data.objects.remove(o)


    for pid, asset in SHOES.items():
        o = add('clothes', asset)
        out[f'feet.{pid}'] = tag(o, f'feet.{pid}', *[mat_texture('clothes', asset)[0]])
        o['normal'] = mat_texture('clothes', asset)[1] or ''
    for pid, asset in HATS.items():
        o = add('clothes', asset)
        out[f'hat.{pid}'] = tag(o, f'hat.{pid}', mat_texture('clothes', asset)[0])

    # hair
    head = rig.data.bones['head']
    hc = (rig.matrix_world @ head.head_local + rig.matrix_world @ head.tail_local) / 2
    for pid, asset in HAIR.items():
        o = add('hair', asset)
        o.name = f'hair.{pid}'
        tex = mat_texture('hair', asset)[0] + ('|own' if asset in OWN_SHADING else '')
        out[f'hair.{pid}'] = tag(o, f'hair.{pid}', tex, 'hair')

    # facial hair: shells lifted off the face, from the body's own faces
    face_hair(out, body, rig, hc)

    # body: covered-by bits
    bits = np.zeros(len(body.data.vertices), dtype=np.float32)
    for i, name in enumerate(HIDE_BITS):
        for v in covered(body, out[name]): bits[v] += float(1 << i)
    attr = body.data.attributes.new('_hide', 'FLOAT', 'POINT')
    attr.data.foreach_set('value', bits)
    # MPFB's own masks are replaced by _hide
    for o in out.values():
        for m in list(o.modifiers):
            if m.type != 'ARMATURE': o.modifiers.remove(m)
        for g in list(o.vertex_groups):
            if g.name.startswith('Delete.'): o.vertex_groups.remove(g)
    bpy.data.objects.remove(basemesh)
    return rig, out


def covered(body, piece, reach=0.028):
    """Body vertices a garment covers: a ray out along the skin's normal meets the garment within reach, the skin
    pokes just through it, or it sits right on the skin. Rest pose, base shape."""
    from mathutils.bvhtree import BVHTree
    dg = bpy.context.evaluated_depsgraph_get()
    tree = BVHTree.FromObject(piece, dg)
    mw = body.matrix_world
    out = set()
    for v in body.data.vertices:
        p = mw @ v.co
        n = (mw.to_3x3() @ v.normal).normalized()
        hit = tree.ray_cast(p - n * 0.002, n, reach)
        if hit[0] is not None: out.add(v.index); continue
        # skin that pokes out through the garment (the garment just behind it)
        hit = tree.ray_cast(p + n * 0.002, -n, 0.02)
        if hit[0] is not None: out.add(v.index); continue
        near = tree.find_nearest(p, 0.004)
        if near[0] is not None: out.add(v.index)
    return out


def face_hair(out, body, rig, hc):
    me = body.data
    if 'face' not in SEL:
        lips = body.vertex_groups['lips'].index
        ears = body.vertex_groups['ears'].index
        dom = dominant(body)
        lipv = [v for v in me.vertices if any(g.group == lips for g in v.groups)]
        lz0, lz1 = min(v.co.z for v in lipv), max(v.co.z for v in lipv)
        lx = max(abs(v.co.x) for v in lipv)
        ly = min(v.co.y for v in lipv)  # the front of the lips (the face looks down -Y)
        headv = [v for v in me.vertices if dom[v.index] == 'head']
        nose = min(headv, key=lambda v: v.co.y)
        chin = min((v for v in headv if abs(v.co.x) < 0.01 and v.co.y < ly + 0.03), key=lambda v: v.co.z)
        ear_y = sum(v.co.y for v in me.vertices if any(g.group == ears for g in v.groups)) / max(1, sum(1 for v in me.vertices if any(g.group == ears for g in v.groups)))
        nose_bot = nose.co.z - 0.012
        sel = {}
        def lipish(v): return any(g.group == lips for g in v.groups) or (abs(v.co.x) < lx + 0.004 and lz0 - 0.004 < v.co.z < lz1 + 0.003 and v.co.y < ly + 0.02)
        for v in me.vertices:
            if dom[v.index] not in ('head', 'neck_01') or any(g.group == ears for g in v.groups): continue
            x, y, z = abs(v.co.x), v.co.y, v.co.z
            if lipish(v): continue
            front = y < ear_y - 0.005
            # a full beard: chin, jaw and cheeks up a line from the mouth corners to the sideburns, a little under the jaw
            eye_z = nose.co.z + 0.03
            top = min(eye_z - 0.022, lz1 + max(0.0, x - lx) * 1.5)
            jaw = front and z < top and z > chin.co.z - 0.028 + x * 0.25
            if jaw: sel.setdefault('beard', set()).add(v.index)
            if front and z < lz0 + 0.002 and z > chin.co.z - 0.012 and x < 0.03: sel.setdefault('goatee', set()).add(v.index)
            if front and lz1 - 0.003 < z < nose_bot and x < lx + 0.01: sel.setdefault('moustache', set()).add(v.index)
        sel['stubble'] = sel['beard']
        sel['goatee'] |= sel['moustache']
        SEL['face'] = sel
    for pid, vs in SEL['face'].items():
        lift = {'beard': 0.0045, 'goatee': 0.004, 'moustache': 0.0035, 'stubble': 0.0008}[pid]
        o = dup(body, f'face.{pid}')
        if o.data.attributes.get('_hide'): o.data.attributes.remove(o.data.attributes['_hide'])
        b = bmesh.new(); b.from_mesh(o.data); b.verts.ensure_lookup_table(); b.faces.ensure_lookup_table()
        keepf = [f for f in b.faces if all(v.index in vs for v in f.verts)]
        bmesh.ops.delete(b, geom=[f for f in b.faces if f not in set(keepf)], context='FACES_ONLY')
        bmesh.ops.delete(b, geom=[v for v in b.verts if not v.link_faces], context='VERTS')
        b.normal_update()
        uvl = b.loops.layers.uv.active
        for v in b.verts: v.co += v.normal * lift
        for f in b.faces:
            for l in f.loops: l[uvl].uv = (l.vert.co.x * 18 + 0.5, l.vert.co.z * 18)
        b.to_mesh(o.data); b.free()
        for m in list(o.modifiers):
            if m.type != 'ARMATURE': o.modifiers.remove(m)
        out[f'face.{pid}'] = tag(o, f'face.{pid}', '@' + pid, 'face')


# ------------------------------------------------------------------ textures + materials
_img_cache = {}
def texture(path, size, mode):
    """A tintable copy of a texture: grey with its average brought to ~0.8 (skin keeps some colour)."""
    key = (path, size, mode)
    if key in _img_cache: return _img_cache[key]
    if path == '@plain':
        img = cotton(size)
    elif path.startswith('@'):
        img = strands(path[1:], size)
    else:
        own = path.endswith('|own')
        if own: path = path[:-4]
        src = bpy.data.images.load(path)
        img = src.copy(); img.name = os.path.splitext(os.path.basename(path))[0] + f'_{mode}'
        bpy.data.images.remove(src)
        if img.size[0] > size: img.scale(size, int(size * img.size[1] / img.size[0]))
        if mode == 'hair' and own: mode = 'tint'
        if mode == 'hair':
            hair_detail(img)
        if mode in ('tint', 'skin'):
            px = np.array(img.pixels[:], dtype=np.float32).reshape(-1, 4)
            lum = px[:, 0] * 0.299 + px[:, 1] * 0.587 + px[:, 2] * 0.114
            used = (px[:, 3] > 0.5) & (lum > 0.03)
            mean = float(lum[used].mean()) if used.any() else 0.5
            g = np.clip(lum * (0.8 / mean), 0, 1)
            if mode == 'skin':
                ratio = px[:, :3] / np.maximum(lum[:, None], 1e-3)
                rgb = np.clip(g[:, None] * (1 + (ratio - 1) * 0.45), 0, 1)
            else:
                rgb = np.repeat(g[:, None], 3, 1)
            px[:, :3] = rgb
            img.pixels[:] = px.ravel()
    _img_cache[key] = img
    return img


def _box(a, r):
    """A box blur of radius r (wrapping), via summed areas."""
    for axis in (0, 1):
        c = np.cumsum(np.concatenate([a.take(range(-r - 1, 0), axis=axis), a, a.take(range(0, r), axis=axis)], axis=axis), axis=axis)
        a = (c.take(range(2 * r + 1, c.shape[axis]), axis=axis) - c.take(range(0, c.shape[axis] - 2 * r - 1), axis=axis)) / (2 * r + 1)
    return a


def hair_detail(img):
    """Hair textures: keep the strands, drop the big dark shapes (painted roots, dark locks), so the tint reads as
    one even colour. Grey at ~0.8 with the strand detail on top; alpha untouched."""
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
    lum = px[..., 0] * 0.299 + px[..., 1] * 0.587 + px[..., 2] * 0.114
    a = (px[..., 3] > 0.3).astype(np.float32)
    r = max(4, w // 40)
    mean = _box(lum * a, r) / np.maximum(_box(a, r), 1e-3)
    detail = lum - mean
    g = np.clip(0.8 + detail * 1.8, 0.5, 1.0)
    px[..., 0] = px[..., 1] = px[..., 2] = g
    img.pixels[:] = px.ravel()


def cotton(size):
    """Plain cotton jersey: grey (tinted by the game) with a fine knit and soft mottling. No print."""
    rng = np.random.default_rng(7)
    h = w = size
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    knit = 0.5 + 0.5 * np.sin(x * 1.6) * np.sin(y * 0.8 + np.sin(x * 0.4))
    mott = rng.random((h // 16 + 1, w // 16 + 1)).astype(np.float32)
    mott = np.kron(mott, np.ones((16, 16), np.float32))[:h, :w]
    g = np.clip(0.8 + (knit - 0.5) * 0.06 + (mott - 0.5) * 0.05 + (rng.random((h, w)) - 0.5) * 0.04, 0, 1).astype(np.float32)
    px = np.stack([g, g, g, np.ones_like(g)], -1)
    img = bpy.data.images.new('cotton', w, h, alpha=True)
    img.pixels[:] = px.ravel()
    return img


def strands(kind, size):
    """Facial hair: vertical strands with ragged alpha (stubble: fine dots)."""
    rng = np.random.default_rng({'beard': 1, 'goatee': 2, 'moustache': 3, 'stubble': 4}[kind])
    h = w = size
    a = np.zeros((h, w), np.float32)
    if kind == 'stubble':
        n = rng.random((h, w))
        a = (n > 0.62).astype(np.float32) * 0.85
    else:
        # dense, short, mostly-vertical hairs: speckle smeared down a few pixels
        n = rng.random((h, w)).astype(np.float32)
        for k in range(1, 4): n = np.maximum(n, np.roll(n, k, axis=0) * (1 - k * 0.12))
        a = (n > 0.5).astype(np.float32)
    g = 0.65 + rng.random((h, w)).astype(np.float32) * 0.35
    px = np.stack([g, g, g, a], -1)
    img = bpy.data.images.new('facial_' + kind, w, h, alpha=True)
    img.pixels[:] = px.ravel()
    return img


def material_for(o):
    kind = o.get('kind', 'cloth')
    tex = o.get('tex')
    size = {'skin': 1024, 'eyes': 256, 'face': 128, 'lashes': 256, 'brows': 256}.get(kind, 512)
    mode = {'skin': 'skin', 'eyes': 'keep', 'lashes': 'keep', 'hair': 'hair', 'brows': 'hair'}.get(kind, 'tint')
    m = bpy.data.materials.new(o['piece'])
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    bsdf.inputs['Roughness'].default_value = {'skin': 0.55, 'hair': 0.6, 'eyes': 0.15}.get(kind, 0.85)
    if tex:
        node = nt.nodes.new('ShaderNodeTexImage')
        node.image = texture(tex, size, mode)
        nt.links.new(node.outputs['Color'], bsdf.inputs['Base Color'])
        if kind in ('hair', 'face', 'brows', 'lashes') or o['piece'] in ('legs.ripped',):
            nt.links.new(node.outputs['Alpha'], bsdf.inputs['Alpha'])
    nrm = o.get('normal')
    if nrm and kind == 'cloth' and os.path.exists(nrm):
        ni = nt.nodes.new('ShaderNodeTexImage')
        img = bpy.data.images.load(nrm)
        if img.size[0] > 512: img.scale(512, 512)
        img.colorspace_settings.name = 'Non-Color'
        ni.image = img
        nm = nt.nodes.new('ShaderNodeNormalMap')
        nt.links.new(ni.outputs['Color'], nm.inputs['Color'])
        nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    o.data.materials.clear()
    o.data.materials.append(m)


# ------------------------------------------------------------------ main
def coords(o):
    a = np.zeros(len(o.data.vertices) * 3, dtype=np.float32)
    o.data.vertices.foreach_get('co', a)
    return a


def bone_mats(rig):
    return {b.name: np.array(b.matrix_local, dtype=np.float64) for b in rig.data.bones}


def skin_weights(o, names):
    """Top-4 bone weights per vertex: (index into names, weight), normalised."""
    col = {g.index: names.index(g.name) for g in o.vertex_groups if g.name in names}
    n = len(o.data.vertices)
    idx = np.zeros((n, 4), np.int32); w = np.zeros((n, 4), np.float64)
    for v in o.data.vertices:
        gs = sorted(((g.weight, col[g.group]) for g in v.groups if g.group in col and g.weight > 0), reverse=True)[:4]
        s = sum(x[0] for x in gs) or 1.0
        for k, (wt, b) in enumerate(gs): idx[v.index, k] = b; w[v.index, k] = wt / s
        if not gs: idx[v.index, 0] = names.index('head') if 'head' in names else 0; w[v.index, 0] = 1.0
    return idx, w


def onto_base(c, sw, names, var_mats, base_mats):
    """Carry a morph build's vertices onto the base skeleton (linear blend skinning, variant rest → base rest), so a
    morph changes shapes, not where the joints are: no taller heads or lower eyes than the bones expect."""
    M = np.stack([base_mats[n] @ np.linalg.inv(var_mats[n]) for n in names])
    v = np.c_[c.reshape(-1, 3), np.ones(len(c) // 3)]
    idx, w = sw
    out = np.zeros((len(v), 4))
    for k in range(4):
        out += w[:, k:k + 1] * np.einsum('nij,nj->ni', M[idx[:, k]], v)
    return out[:, :3].astype(np.float32).ravel()


for sex in SEXES:
    shapes = {}
    rig, out = build(sex, {}, True)
    base_counts = {k: len(o.data.vertices) for k, o in out.items()}
    names = [b.name for b in rig.data.bones]
    base_mats = bone_mats(rig)
    weights = {k: skin_weights(o, names) for k, o in out.items()}
    # the morph builds reuse the base's selections; their vertices become shape keys on the base
    for vname, ph in VARIANTS.items():
        vrig, vout = build(sex, ph, False)
        vm = bone_mats(vrig)
        shapes[vname] = {}
        for k, o in vout.items():
            if len(o.data.vertices) != base_counts[k]:
                print('MISMATCH', sex, vname, k, len(o.data.vertices), base_counts[k]); continue
            shapes[vname][k] = onto_base(coords(o), weights[k], names, vm, base_mats)
    rig, out = build(sex, {}, False)
    for k, o in out.items():
        o.shape_key_add(name='Basis', from_mix=False)
        for vname in VARIANTS:
            c = shapes[vname].get(k)
            if c is None: continue
            sk = o.shape_key_add(name=vname, from_mix=False)
            sk.data.foreach_set('co', c)
        material_for(o)
    rig.name = 'rig'
    bpy.ops.object.select_all(action='DESELECT')
    rig.select_set(True)
    for o in out.values(): o.select_set(True)
    bpy.context.view_layer.objects.active = rig
    path = os.path.join(OUT, f'band-{sex}.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_apply=False,
                              export_skins=True, export_morph=True, export_morph_normal=False, export_animations=False,
                              export_attributes=True, export_image_format='WEBP', export_image_quality=82,
                              export_extras=True, export_materials='EXPORT')
    print('WROTE', path, os.path.getsize(path))
    meta = {'pieces': sorted(out.keys()), 'hide': HIDE_BITS, 'morphs': list(VARIANTS)}
    json.dump(meta, open(os.path.join(OUT, f'band-{sex}.json'), 'w'), indent=1)
